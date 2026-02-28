"""
SERVICIO DE GOOGLE DRIVE
========================
Gestiona la integración con Google Drive para consultores:
- OAuth2 authentication (tokens por consultor)
- Creación automática de estructura de carpetas completa
- Upload de documentos a la carpeta correcta
- Sincronización con el pipeline de ingesta

Estructura completa en Drive: ver FOLDER_STRUCTURE
"""

import logging
import time
from typing import Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.http import MediaInMemoryUpload
import io
from googleapiclient.http import MediaIoBaseDownload
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

# Retry config for Google API calls
_RETRY_DELAYS = [1, 2, 4, 8]  # seconds — exponential backoff
_RETRYABLE_CODES = {500, 502, 503, 429}  # Google transient errors + rate limit

# Full Drive access needed to browse user-uploaded files
SCOPES = ["https://www.googleapis.com/auth/drive"]

ROOT_FOLDER_NAME = "RAG_Residuos_Industriales"

# ═══════════════════════════════════════════════════════════════
# COMUNIDADES AUTÓNOMAS Y PROVINCIAS
# ═══════════════════════════════════════════════════════════════

COMUNIDADES_AUTONOMAS: dict[str, list[str]] = {
    "01_Andalucia": [
        "Almeria", "Cadiz", "Cordoba", "Granada",
        "Huelva", "Jaen", "Malaga", "Sevilla",
    ],
    "02_Aragon": ["Huesca", "Teruel", "Zaragoza"],
    "03_Asturias": ["Asturias"],
    "04_Baleares": ["Islas_Baleares"],
    "05_Canarias": ["Las_Palmas", "Santa_Cruz_de_Tenerife"],
    "06_Cantabria": ["Cantabria"],
    "07_Castilla_La_Mancha": [
        "Albacete", "Ciudad_Real", "Cuenca", "Guadalajara", "Toledo",
    ],
    "08_Castilla_y_Leon": [
        "Avila", "Burgos", "Leon", "Palencia", "Salamanca",
        "Segovia", "Soria", "Valladolid", "Zamora",
    ],
    "09_Cataluna": ["Barcelona", "Girona", "Lleida", "Tarragona"],
    "10_Comunitat_Valenciana": ["Alicante", "Castellon", "Valencia"],
    "11_Extremadura": ["Badajoz", "Caceres"],
    "12_Galicia": ["A_Coruna", "Lugo", "Ourense", "Pontevedra"],
    "13_Madrid": ["Madrid"],
    "14_Murcia": ["Murcia"],
    "15_Navarra": ["Navarra"],
    "16_Pais_Vasco": ["Alava", "Guipuzcoa", "Vizcaya"],
    "17_La_Rioja": ["La_Rioja"],
    "18_Ceuta": ["Ceuta"],
    "19_Melilla": ["Melilla"],
}

# Subcarpetas dentro de cada comunidad autónoma (en legislación)
CCAA_LEGISLATION_SUBS = [
    "Legislacion_Autonomica",
    "Planes_Autonomicos",
    "Autorizaciones_Ambientales",
]

# Subcarpetas dentro de cada provincia
PROVINCE_SUBS = [
    "Normativa_Provincial",
    "Ordenanzas_Municipales",
    "Planes_Locales",
]

# ═══════════════════════════════════════════════════════════════
# SECTORES INDUSTRIALES (02_Documentacion_Tecnica)
# ═══════════════════════════════════════════════════════════════

INDUSTRY_SECTORS = [
    "01_Quimica_Petroquimica",
    "02_Metalurgia_Siderurgia",
    "03_Alimentaria_Bebidas",
    "04_Construccion_Demolicion",
    "05_Farmaceutica_Cosmetica",
    "06_Textil_Curtidos",
    "07_Energia_Combustibles",
    "08_Mineria_Canteras",
    "09_Automocion_Transporte",
    "10_Papel_Celulosa_Madera",
    "11_Plasticos_Caucho",
    "12_Electronica_RAEE",
    "13_Tratamiento_Superficies",
    "14_Pintura_Lacas_Disolventes",
    "15_Ceramica_Vidrio",
    "16_Agricultura_Ganaderia",
]

INDUSTRY_SUBS = [
    "MTD_BAT",
    "Fichas_Seguridad",
    "Caracterizacion_Residuos",
    "Procedimientos_Gestion",
    "Tratamiento_Valorizacion",
    "Emisiones_Vertidos",
    "Buenas_Practicas",
]

# ═══════════════════════════════════════════════════════════════
# TIPOS DE GESTORES DE RESIDUOS (03_Gestores_Residuos)
# ═══════════════════════════════════════════════════════════════

WASTE_MANAGER_TYPES = [
    "01_Vertederos_Deposito",
    "02_Incineracion_Valorizacion_Energetica",
    "03_Tratamiento_Fisicoquimico",
    "04_Tratamiento_Biologico",
    "05_Reciclaje_Valorizacion_Material",
    "06_Transferencia_Almacenamiento",
    "07_Transporte_Residuos",
    "08_Gestion_RAEE",
    "09_Gestion_VFU_Vehiculos",
    "10_Gestion_NFU_Neumaticos",
    "11_Gestion_Aceites_Usados",
    "12_Gestion_RCD_Construccion",
    "13_Gestion_Residuos_Sanitarios",
    "14_Gestion_Disolventes_Quimicos",
    "15_Gestion_PCB_Transformadores",
    "16_Descontaminacion_Suelos",
]

MANAGER_TYPE_SUBS = [
    "Directorio_Empresas",
    "Autorizaciones_Vigentes",
    "Capacidades_Tratamiento",
    "Tarifas_Costes",
    "Certificaciones",
]


def _build_client_config(client_id: str, client_secret: str) -> dict:
    """Build the client config dict for Google OAuth2 flow."""
    return {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }


def get_auth_url(
    client_id: str,
    client_secret: str,
    redirect_uri: str,
    state: str = "",
) -> str:
    """Generate the Google OAuth2 authorization URL."""
    flow = Flow.from_client_config(
        _build_client_config(client_id, client_secret),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=state,
    )
    return auth_url


def exchange_code(
    code: str,
    client_id: str,
    client_secret: str,
    redirect_uri: str,
) -> dict:
    """Exchange the authorization code for access and refresh tokens."""
    flow = Flow.from_client_config(
        _build_client_config(client_id, client_secret),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
    )
    flow.fetch_token(code=code)
    creds = flow.credentials
    return {
        "access_token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_expiry": creds.expiry.isoformat() if creds.expiry else None,
    }


class GoogleDriveService:
    """Manages Google Drive operations for a single consultant."""

    def __init__(
        self,
        access_token: str,
        refresh_token: str,
        client_id: str,
        client_secret: str,
    ):
        creds = Credentials(
            token=access_token,
            refresh_token=refresh_token,
            token_uri="https://oauth2.googleapis.com/token",
            client_id=client_id,
            client_secret=client_secret,
        )
        self.service = build("drive", "v3", credentials=creds)
        self._creds = creds
        self._created_count = 0
        # Cache: (parent_id, name) -> folder_id  — avoids repeated API lookups
        self._folder_cache: dict[tuple[str | None, str], str] = {}

    @property
    def refreshed_token(self) -> Optional[str]:
        """Return the current access token (may have been refreshed)."""
        return self._creds.token

    # ──────────────────────────────────────────────────
    # FOLDER OPERATIONS
    # ──────────────────────────────────────────────────

    def create_folder(self, name: str, parent_id: Optional[str] = None) -> str:
        """Create a folder in Drive. Returns the folder ID."""
        metadata: dict = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
        }
        if parent_id:
            metadata["parents"] = [parent_id]

        result = self.service.files().create(body=metadata, fields="id").execute()
        folder_id = result["id"]
        self._created_count += 1
        logger.debug(f"Carpeta creada [{self._created_count}]: {name}")
        return folder_id

    def _preload_folder_tree(self, root_id: str) -> None:
        """Fetch ALL folders from the user's Drive in one paginated query.

        Populates _folder_cache so get_or_create_folder can skip individual
        find_folder API calls (~1800 lookups reduced to ~2-5 paginated list calls).
        """
        self._folder_cache.clear()
        page_token = None
        total = 0
        q = "mimeType='application/vnd.google-apps.folder' and trashed=false"
        while True:
            resp = (
                self.service.files()
                .list(
                    q=q,
                    fields="nextPageToken, files(id, name, parents)",
                    pageSize=1000,
                    pageToken=page_token,
                )
                .execute()
            )
            for f in resp.get("files", []):
                for p in f.get("parents", []):
                    self._folder_cache[(p, f["name"])] = f["id"]
                total += 1
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        logger.info("Preloaded %d existing folders into cache", total)

    def find_folder(self, name: str, parent_id: Optional[str] = None) -> Optional[str]:
        """Find a folder by name under a parent. Returns folder ID or None."""
        # Check cache first
        cached = self._folder_cache.get((parent_id, name))
        if cached:
            return cached

        q = (
            f"name='{name}' "
            f"and mimeType='application/vnd.google-apps.folder' "
            f"and trashed=false"
        )
        if parent_id:
            q += f" and '{parent_id}' in parents"

        result = self.service.files().list(q=q, fields="files(id)", pageSize=1).execute()
        files = result.get("files", [])
        if files:
            self._folder_cache[(parent_id, name)] = files[0]["id"]
            return files[0]["id"]
        return None

    def get_or_create_folder(self, name: str, parent_id: Optional[str] = None) -> str:
        """Find an existing folder (from cache or API) or create it. Returns folder ID."""
        existing = self.find_folder(name, parent_id)
        if existing:
            return existing
        folder_id = self.create_folder(name, parent_id)
        self._folder_cache[(parent_id, name)] = folder_id
        return folder_id

    def _create_children(self, parent_id: str, children: list[str]) -> dict[str, str]:
        """Create multiple child folders under a parent. Returns name->id mapping."""
        result = {}
        for name in children:
            result[name] = self.get_or_create_folder(name, parent_id)
        return result

    # ──────────────────────────────────────────────────
    # FULL STRUCTURE SETUP
    # ──────────────────────────────────────────────────

    def setup_full_structure(self, root_folder_id: Optional[str] = None) -> dict:
        """
        Create the complete RAG_Residuos_Industriales folder structure.

        Args:
            root_folder_id: If provided (e.g. from Picker), use this folder
                            as root instead of creating/searching for one.

        Returns a dict with key folder IDs for navigation.
        """
        self._created_count = 0
        logger.info("Creando estructura completa de carpetas en Google Drive...")

        root_id = root_folder_id or self.get_or_create_folder(ROOT_FOLDER_NAME)

        # Preload existing folder tree to avoid ~1800 individual API lookups
        self._preload_folder_tree(root_id)

        # Create all 7 top-level sections
        s01 = self.get_or_create_folder("01_Legislacion_Regulacion", root_id)
        s02 = self.get_or_create_folder("02_Documentacion_Tecnica", root_id)
        s03 = self.get_or_create_folder("03_Gestores_Residuos", root_id)
        s04 = self.get_or_create_folder("04_Clasificacion_Residuos", root_id)
        s05 = self.get_or_create_folder("05_Gestion_Operativa", root_id)
        s06 = self.get_or_create_folder("06_Referencia", root_id)
        s07 = self.get_or_create_folder("07_Config_RAG", root_id)

        # ── 01. LEGISLACIÓN ──────────────────────────────
        self._setup_legislation(s01)

        # ── 02. DOCUMENTACIÓN TÉCNICA ────────────────────
        self._setup_technical_docs(s02)

        # ── 03. GESTORES DE RESIDUOS ─────────────────────
        self._setup_waste_managers(s03)

        # ── 04. CLASIFICACIÓN RESIDUOS ───────────────────
        self._setup_waste_classification(s04)

        # ── 05. GESTIÓN OPERATIVA ────────────────────────
        self._setup_operational(s05)

        # ── 06. REFERENCIA ───────────────────────────────
        self._setup_reference(s06)

        # ── 07. CONFIG RAG ───────────────────────────────
        self._create_children(s07, [
            "Metadatos", "Plantillas_Indexacion", "Logs_Ingestas",
        ])

        logger.info(
            f"Estructura completa creada: {self._created_count} carpetas "
            f"en Google Drive (root: {root_id})"
        )

        return {
            "root_folder_id": root_id,
            "legislacion_folder_id": s01,
            "documentacion_tecnica_folder_id": s02,
            "gestores_folder_id": s03,
            "clasificacion_folder_id": s04,
            "gestion_operativa_folder_id": s05,
            "referencia_folder_id": s06,
            "config_rag_folder_id": s07,
        }

    def _setup_legislation(self, parent_id: str):
        """01_Legislacion_Regulacion"""
        # Europea
        eu = self.get_or_create_folder("01_Europea_UE", parent_id)
        self._create_children(eu, [
            "Directivas", "Reglamentos", "Decisiones",
            "Comunicaciones_y_Guias", "BREF_MTD",
        ])

        # Nacional
        nat = self.get_or_create_folder("02_Nacional_Espana", parent_id)
        self._create_children(nat, [
            "Leyes", "Reales_Decretos", "Ordenes_Ministeriales",
            "Planes_Estrategicos_Nacionales", "MITERD_Guias",
        ])

        # Comunidades Autónomas
        ccaa_parent = self.get_or_create_folder("03_Comunidades_Autonomas", parent_id)
        for ccaa_name, provinces in COMUNIDADES_AUTONOMAS.items():
            ccaa_id = self.get_or_create_folder(ccaa_name, ccaa_parent)
            self._create_children(ccaa_id, CCAA_LEGISLATION_SUBS)

            # Provincias
            prov_parent = self.get_or_create_folder("Provincias", ccaa_id)
            for prov in provinces:
                prov_id = self.get_or_create_folder(prov, prov_parent)
                self._create_children(prov_id, PROVINCE_SUBS)

    def _setup_technical_docs(self, parent_id: str):
        """02_Documentacion_Tecnica"""
        for sector in INDUSTRY_SECTORS:
            sector_id = self.get_or_create_folder(sector, parent_id)
            self._create_children(sector_id, INDUSTRY_SUBS)

    def _setup_waste_managers(self, parent_id: str):
        """03_Gestores_Residuos"""
        # Nacional
        nacional = self.get_or_create_folder("01_Nacional", parent_id)
        for mgr_type in WASTE_MANAGER_TYPES:
            mgr_id = self.get_or_create_folder(mgr_type, nacional)
            self._create_children(mgr_id, MANAGER_TYPE_SUBS)

        # Por Comunidad Autónoma
        por_ccaa = self.get_or_create_folder("02_Por_Comunidad_Autonoma", parent_id)
        for ccaa_name, provinces in COMUNIDADES_AUTONOMAS.items():
            ccaa_id = self.get_or_create_folder(ccaa_name, por_ccaa)
            # 16 tipos de gestor at CCAA level
            for mgr_type in WASTE_MANAGER_TYPES:
                self.get_or_create_folder(mgr_type, ccaa_id)

            # Provincias
            prov_parent = self.get_or_create_folder("Provincias", ccaa_id)
            for prov in provinces:
                prov_id = self.get_or_create_folder(prov, prov_parent)
                for mgr_type in WASTE_MANAGER_TYPES:
                    self.get_or_create_folder(mgr_type, prov_id)

    def _setup_waste_classification(self, parent_id: str):
        """04_Clasificacion_Residuos"""
        self.get_or_create_folder("Catalogo_Europeo_Residuos_LER", parent_id)

        peligrosos = self.get_or_create_folder("Residuos_Peligrosos", parent_id)
        self._create_children(peligrosos, ["Fichas_Clasificacion", "Codigos_HP"])

        self.get_or_create_folder("Residuos_No_Peligrosos", parent_id)
        self.get_or_create_folder("Tablas_Equivalencia_Codigos", parent_id)
        self.get_or_create_folder("SANDACH_Subproductos_Animales", parent_id)

    def _setup_operational(self, parent_id: str):
        """05_Gestion_Operativa"""
        # Autorizaciones
        auth = self.get_or_create_folder("Autorizaciones_Licencias", parent_id)
        self._create_children(auth, [
            "Autorizacion_Ambiental_Integrada",
            "Autorizacion_Ambiental_Unificada",
            "Comunicaciones_Previas",
        ])

        # Registros
        reg = self.get_or_create_folder("Registros", parent_id)
        self._create_children(reg, [
            "Registro_Productores_RPGR",
            "Registro_Gestores",
            "Registro_Transportistas",
        ])

        # Documentos de control
        docs = self.get_or_create_folder("Documentos_Control", parent_id)
        self._create_children(docs, [
            "Notificacion_Previa_Traslado",
            "Documento_Identificacion",
            "Contrato_Tratamiento",
            "Memorias_Anuales",
        ])

        # Traslados transfronterizos
        trans = self.get_or_create_folder("Traslados_Transfronterizos", parent_id)
        self._create_children(trans, [
            "Reglamento_1013_2006", "Formularios",
        ])

        # Sistemas de gestión
        sg = self.get_or_create_folder("Sistemas_Gestion", parent_id)
        self._create_children(sg, [
            "ISO_14001", "EMAS", "Economia_Circular",
        ])

    def _setup_reference(self, parent_id: str):
        """06_Referencia"""
        self.get_or_create_folder("Glosarios_Terminologia", parent_id)
        self.get_or_create_folder("Tablas_Conversion_Unidades", parent_id)

        org = self.get_or_create_folder("Organismos_Competentes", parent_id)
        self._create_children(org, ["Europeos", "Nacionales", "Autonomicos"])

        self.get_or_create_folder("Jurisprudencia_Sanciones", parent_id)
        self.get_or_create_folder("Estadisticas_Datos", parent_id)

    # ──────────────────────────────────────────────────
    # FILE OPERATIONS
    # ──────────────────────────────────────────────────

    def upload_file(
        self,
        file_bytes: bytes,
        filename: str,
        folder_id: str,
        mime_type: str = "application/octet-stream",
    ) -> str:
        """Upload a file to a specific folder. Returns the file ID."""
        metadata = {
            "name": filename,
            "parents": [folder_id],
        }
        media = MediaInMemoryUpload(file_bytes, mimetype=mime_type)
        result = (
            self.service.files()
            .create(body=metadata, media_body=media, fields="id")
            .execute()
        )
        file_id = result["id"]
        logger.info(f"Archivo subido a Drive: {filename} ({file_id})")
        return file_id

    def get_file_url(self, file_id: str) -> str:
        """Get the web view URL for a file."""
        return f"https://drive.google.com/file/d/{file_id}/view"

    # ──────────────────────────────────────────────────
    # BROWSE & DOWNLOAD
    # ──────────────────────────────────────────────────

    def list_folder(self, folder_id: str, page_token: Optional[str] = None) -> dict:
        """
        List contents of a folder with retry on transient Google errors.
        Returns {items: [{id, name, mimeType, size, modifiedTime, isFolder}], nextPageToken?}
        """
        q = f"'{folder_id}' in parents and trashed=false"
        fields = "nextPageToken, files(id, name, mimeType, size, modifiedTime)"

        last_error: Exception | None = None
        for attempt, delay in enumerate(_RETRY_DELAYS, 1):
            try:
                result = (
                    self.service.files()
                    .list(
                        q=q,
                        fields=fields,
                        pageSize=100,
                        orderBy="folder,name",
                        pageToken=page_token or None,
                    )
                    .execute()
                )
                break  # success
            except HttpError as e:
                last_error = e
                if e.resp.status in _RETRYABLE_CODES and attempt < len(_RETRY_DELAYS):
                    logger.warning("list_folder(%s): HTTP %s on attempt %d, retrying in %ds", folder_id, e.resp.status, attempt, delay)
                    time.sleep(delay)
                else:
                    raise
            except Exception as e:
                last_error = e
                if attempt < len(_RETRY_DELAYS):
                    logger.warning("list_folder(%s): %s on attempt %d, retrying in %ds", folder_id, type(e).__name__, attempt, delay)
                    time.sleep(delay)
                else:
                    raise
        else:
            raise last_error  # type: ignore[misc]

        items = []
        for f in result.get("files", []):
            is_folder = f["mimeType"] == "application/vnd.google-apps.folder"
            items.append({
                "id": f["id"],
                "name": f["name"],
                "mimeType": f["mimeType"],
                "size": int(f.get("size", 0)) if not is_folder else None,
                "modifiedTime": f.get("modifiedTime"),
                "isFolder": is_folder,
            })

        resp: dict = {"items": items}
        if result.get("nextPageToken"):
            resp["nextPageToken"] = result["nextPageToken"]
        return resp

    def list_all_files_recursive(
        self,
        folder_id: str,
        supported_extensions: set[str] | None = None,
        _path: str = "",
        max_folders: int = 0,
    ) -> list[dict]:
        """
        Iteratively (BFS) list ALL files under a folder.
        Returns flat list of {id, name, mimeType, size, modifiedTime, path}.

        Uses a queue instead of deep recursion to avoid stack overflow on
        large Drive structures.  Pauses 0.3s between folder scans to stay
        well within Google Drive API rate limits.
        """
        from collections import deque

        if supported_extensions is None:
            supported_extensions = {
                ".pdf", ".docx", ".doc", ".xlsx", ".xls",
                ".csv", ".txt", ".html", ".htm", ".md",
            }

        all_files: list[dict] = []
        # BFS queue: (folder_id, path_prefix)
        folder_queue: deque[tuple[str, str]] = deque()
        folder_queue.append((folder_id, _path))
        folders_scanned = 0

        while folder_queue:
            current_folder_id, current_path = folder_queue.popleft()
            page_token: str | None = None

            while True:
                listing = self.list_folder(current_folder_id, page_token)

                for item in listing["items"]:
                    item_path = f"{current_path}/{item['name']}" if current_path else item["name"]

                    if item["isFolder"]:
                        folder_queue.append((item["id"], item_path))
                    else:
                        name_lower = item["name"].lower()
                        ext = "." + name_lower.rsplit(".", 1)[-1] if "." in name_lower else ""
                        if ext in supported_extensions:
                            item["path"] = item_path
                            all_files.append(item)

                page_token = listing.get("nextPageToken")
                if not page_token:
                    break

            folders_scanned += 1
            if max_folders > 0 and folders_scanned >= max_folders:
                logger.info("Drive scan: folder limit reached (%d), returning %d files found so far", max_folders, len(all_files))
                break

            # Throttle: pause between folders to avoid Google API rate limits
            if folder_queue:
                time.sleep(0.1)

            # Log progress every 20 folders
            if folders_scanned % 20 == 0:
                logger.info("Drive scan: %d folders scanned, %d files found so far, %d folders queued", folders_scanned, len(all_files), len(folder_queue))

        logger.info("Drive scan complete: %d folders scanned, %d files found", folders_scanned, len(all_files))
        return all_files

    def download_file(self, file_id: str) -> tuple[bytes, str, str]:
        """
        Download a file from Drive with retry on transient errors.
        Returns (file_bytes, filename, mime_type).
        """
        # Get file metadata first (with retry)
        meta = None
        last_error: Exception | None = None
        for attempt, delay in enumerate(_RETRY_DELAYS, 1):
            try:
                meta = (
                    self.service.files()
                    .get(fileId=file_id, fields="name, mimeType, size")
                    .execute()
                )
                break
            except HttpError as e:
                last_error = e
                if e.resp.status in _RETRYABLE_CODES and attempt < len(_RETRY_DELAYS):
                    logger.warning("download_file(%s) meta: HTTP %s on attempt %d, retrying in %ds", file_id, e.resp.status, attempt, delay)
                    time.sleep(delay)
                else:
                    raise
            except Exception as e:
                last_error = e
                if attempt < len(_RETRY_DELAYS):
                    time.sleep(delay)
                else:
                    raise
        if meta is None:
            raise last_error  # type: ignore[misc]

        filename = meta["name"]
        mime_type = meta.get("mimeType", "application/octet-stream")

        # Download content (with retry)
        for attempt, delay in enumerate(_RETRY_DELAYS, 1):
            try:
                request = self.service.files().get_media(fileId=file_id)
                buffer = io.BytesIO()
                downloader = MediaIoBaseDownload(buffer, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()
                buffer.seek(0)
                return buffer.read(), filename, mime_type
            except HttpError as e:
                if e.resp.status in _RETRYABLE_CODES and attempt < len(_RETRY_DELAYS):
                    logger.warning("download_file(%s) content: HTTP %s on attempt %d, retrying in %ds", file_id, e.resp.status, attempt, delay)
                    time.sleep(delay)
                else:
                    raise
            except Exception:
                if attempt < len(_RETRY_DELAYS):
                    time.sleep(delay)
                else:
                    raise

        raise RuntimeError(f"download_file({file_id}): all retries exhausted")
