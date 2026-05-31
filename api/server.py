"""
ResidusIA Pro - API Server
Expone el pipeline de procesamiento de documentos via HTTP.
"""

import gc
import ipaddress
import json
import os
import re
import socket
import sys
import time
from contextlib import asynccontextmanager
from typing import Optional

import asyncio
import logging
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

_UUID_PATTERN = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
_VALID_TIERS = {"standard", "pro_plus"}
_VALID_MODELS = {
    "claude-opus-4-6", "claude-sonnet-4", "claude-haiku-4-5",
    "gpt-5.2", "gpt-5", "o3", "o4-mini", "gpt-5-mini",
    "gemini-2.5-pro", "gemini-2.5-flash",
}
_VALID_AGENTS = {"aai", "contratos", "facturas", "registro", "normativo"}

logging.basicConfig(level=logging.INFO, stream=sys.stdout)
logger = logging.getLogger("residusia")
logger.setLevel(logging.INFO)

# Silence noisy HTTP client loggers — these flood Railway logs as false "errors"
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

# Ensure the project root is in the Python path (works locally and in Docker)
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from pipeline import UnifiedIngestionService, PipelineConfigImpl, RAGScopingService, RAGScope
from pipeline.cost_guard import CostGuard, calculate_cost, get_provider, MODEL_PRICING
from pipeline.model_router import ModelRouter, MODEL_API_IDS, MODEL_PROVIDERS, SERVICE_DEFAULTS


service: UnifiedIngestionService | None = None
rag_service: RAGScopingService | None = None
_config: PipelineConfigImpl | None = None
_cost_guard: CostGuard | None = None
_model_router: ModelRouter | None = None

# Strong references to background tasks so GC doesn't kill them.
# See: https://docs.python.org/3/library/asyncio-task.html#asyncio.create_task
_background_tasks: set[asyncio.Task] = set()


FULLFILE_MARKER
