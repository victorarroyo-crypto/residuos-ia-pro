"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Zap, Flame, Sparkles, Leaf } from "lucide-react";

interface ModelOption {
  id: string;
  label: string;
  provider: string;
  costEstimate: string;
  icon: React.ReactNode;
  tier?: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  { id: "claude-sonnet-4", label: "Sonnet 4", provider: "Anthropic", costEstimate: "~$0.35", icon: <Zap className="h-3 w-3" />, tier: "standard" },
  { id: "claude-opus-4-6", label: "Opus 4.6", provider: "Anthropic", costEstimate: "~$3.00", icon: <Flame className="h-3 w-3 text-orange-500" />, tier: "pro_plus" },
  { id: "gpt-5.2", label: "GPT-5.2", provider: "OpenAI", costEstimate: "~$1.50", icon: <Sparkles className="h-3 w-3 text-emerald-500" />, tier: "pro_plus" },
  { id: "gpt-5", label: "GPT-5", provider: "OpenAI", costEstimate: "~$0.25", icon: <Zap className="h-3 w-3 text-emerald-500" /> },
  { id: "o3", label: "o3", provider: "OpenAI", costEstimate: "~$0.30", icon: <Sparkles className="h-3 w-3 text-emerald-500" /> },
  { id: "gemini-2.5-pro", label: "Gemini Pro", provider: "Google", costEstimate: "~$0.25", icon: <Zap className="h-3 w-3 text-blue-500" /> },
  { id: "claude-haiku-4-5", label: "Haiku 4.5", provider: "Anthropic", costEstimate: "~$0.08", icon: <Leaf className="h-3 w-3 text-green-500" /> },
  { id: "gemini-2.5-flash", label: "Gemini Flash", provider: "Google", costEstimate: "~$0.02", icon: <Leaf className="h-3 w-3 text-blue-500" /> },
];

const TIER_OPTIONS = [
  { id: "standard", label: "Standard", description: "1 llamada API" },
  { id: "pro_plus", label: "PRO+", description: "Loop agentic (3-4 llamadas)" },
];

interface ModelSelectorProps {
  selectedModel: string;
  selectedTier: string;
  onModelChange: (model: string) => void;
  onTierChange: (tier: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

export function ModelSelector({
  selectedModel,
  selectedTier,
  onModelChange,
  onTierChange,
  compact = false,
  disabled = false,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const current = MODEL_OPTIONS.find((m) => m.id === selectedModel) || MODEL_OPTIONS[0];
  const currentTier = TIER_OPTIONS.find((t) => t.id === selectedTier) || TIER_OPTIONS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        className={`
          flex items-center gap-1 rounded-md border bg-background text-xs
          transition-colors hover:bg-muted disabled:opacity-50
          ${compact ? "px-1.5 py-1" : "px-2 py-1.5"}
        `}
        title={`${current.label} (${currentTier.label})`}
      >
        {current.icon}
        {!compact && <span className="font-medium">{current.label}</span>}
        {selectedTier === "pro_plus" && (
          <span className="rounded bg-orange-100 px-1 py-0.5 text-[9px] font-bold text-orange-700">
            PRO+
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-muted-foreground" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 w-72 rounded-lg border bg-background shadow-lg">
          {/* Tier selector */}
          <div className="border-b p-2">
            <p className="text-[10px] text-muted-foreground mb-1.5">Modo de operacion</p>
            <div className="flex gap-1">
              {TIER_OPTIONS.map((tier) => (
                <button
                  key={tier.id}
                  onClick={() => onTierChange(tier.id)}
                  className={`
                    flex-1 rounded-md px-2 py-1.5 text-xs transition-colors
                    ${selectedTier === tier.id
                      ? "bg-vandarum-teal text-white"
                      : "bg-muted hover:bg-muted/80"
                    }
                  `}
                >
                  <span className="font-medium">{tier.label}</span>
                  <span className="block text-[9px] opacity-75">{tier.description}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Model list */}
          <div className="max-h-[280px] overflow-y-auto p-1">
            <p className="px-2 py-1 text-[10px] text-muted-foreground">Modelo</p>
            {MODEL_OPTIONS.map((model) => (
              <button
                key={model.id}
                onClick={() => {
                  onModelChange(model.id);
                  setIsOpen(false);
                }}
                className={`
                  flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors
                  ${selectedModel === model.id
                    ? "bg-vandarum-teal/10 text-vandarum-teal"
                    : "hover:bg-muted"
                  }
                `}
              >
                {model.icon}
                <div className="flex-1 text-left">
                  <span className="font-medium">{model.label}</span>
                  <span className="ml-1 text-muted-foreground">{model.provider}</span>
                </div>
                <span className="text-muted-foreground">{model.costEstimate}</span>
                {model.tier === "pro_plus" && (
                  <span className="rounded bg-orange-100 px-1 py-0.5 text-[9px] font-bold text-orange-700">
                    PRO+
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
