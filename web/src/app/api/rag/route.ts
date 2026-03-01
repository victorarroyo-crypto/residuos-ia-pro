import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadEnv } from "@/lib/env";

type RpcChunk = {
  chunk_id: string;
  document_id: string;
  contenido: string;
  chunk_type: string;
  similarity: number;
  text_rank: number;
  hybrid_score: number;
  doc_titulo: string;
  doc_tipo: string;
  source?: string;
};

type RankedChunk = RpcChunk & {
  finalScore: number;
  sourceScope: "general" | "project";
};

async function embedQuery(query: string, openaiKey: string): Promise<number[] | null> {
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-large",
        input: query,
        dimensions: 1536,
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}


function cSourceToScope(source?: string): "general" | "project" {
  return source === "project" ? "project" : "general";
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.detail }, { status: admin.status });
  }

  try {
    const body = await request.json();
    const query = body.query as string;
    const topK = Math.max(1, Math.min((body.top_k as number) || 5, 15));
    const scope = (body.scope as "general" | "project" | "combined") || "general";
    const projectId = body.project_id as string | undefined;

    if (!query) {
      return NextResponse.json(
        { error: "Se requiere un campo 'query'" },
        { status: 400 }
      );
    }

    // Ownership check: si scope=project o combined con project_id, verificar ownership
    if (projectId && (scope === "project" || scope === "combined")) {
      const { data: project } = await admin.client
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("consultant_id", user.id)
        .single();
      if (!project) {
        return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 403 });
      }
    }

    const openaiKey = loadEnv("OPENAI_API_KEY");
    if (!openaiKey) {
      return NextResponse.json(
        {
          error:
            "OPENAI_API_KEY no configurada. La ruta /api/rag requiere embeddings para búsqueda semántica.",
        },
        { status: 503 }
      );
    }

    const queryEmbedding = await embedQuery(query, openaiKey);
    if (!queryEmbedding) {
      return NextResponse.json(
        { error: "No se pudo generar el embedding de la consulta." },
        { status: 502 }
      );
    }

    const sb = admin.client;
    let rpcRows: RpcChunk[] = [];
    const candidateLimit = Math.max(topK * 8, 20);
    const threshold = 0.5;

    if (scope === "project") {
      if (!projectId) {
        return NextResponse.json(
          { error: "scope=project requiere project_id" },
          { status: 400 }
        );
      }
      const { data, error } = await sb.rpc("search_project", {
        query_embedding: queryEmbedding,
        p_project_id: projectId,
        doc_type_filter: null,
        match_threshold: threshold,
        match_count: candidateLimit,
        query_text: query,
      });
      if (error) throw new Error(error.message);
      rpcRows = (data || []) as RpcChunk[];
    } else if (scope === "combined") {
      const { data, error } = await sb.rpc("search_combined", {
        query_embedding: queryEmbedding,
        p_project_id: projectId || null,
        doc_type_filter: null,
        match_threshold: threshold,
        match_count_kb: candidateLimit,
        match_count_project: candidateLimit,
        query_text: query,
      });
      if (error) throw new Error(error.message);
      rpcRows = (data || []) as RpcChunk[];
    } else {
      const { data, error } = await sb.rpc("search_knowledge", {
        query_embedding: queryEmbedding,
        doc_type_filter: null,
        match_threshold: threshold,
        match_count: candidateLimit,
        query_text: query,
      });
      if (error) throw new Error(error.message);
      rpcRows = (data || []) as RpcChunk[];
    }

    if (rpcRows.length === 0) {
      return NextResponse.json({
        answer:
          "No encontre informacion relevante en la base de conocimiento para esta consulta. Intenta reformular la pregunta o verifica que hay documentos indexados.",
        sources: [],
      });
    }

    // Usar hybrid_score de PostgreSQL (vector + full-text con stemming español).
    // Ya viene ordenado por hybrid_score DESC desde SQL, pero re-sort por seguridad.
    const ranked: RankedChunk[] = rpcRows.map((row) => ({
      ...row,
      finalScore: Number.isFinite(row.hybrid_score)
        ? row.hybrid_score
        : Number.isFinite(row.similarity)
          ? row.similarity
          : 0,
      sourceScope:
        scope === "combined"
          ? cSourceToScope(row.source)
          : scope,
    }));

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    const topChunks = ranked.slice(0, topK);

    const context = topChunks
      .map(
        (c, i) =>
          `[Fuente ${i + 1}] ${c.doc_titulo || "Documento"} (score: ${c.finalScore.toFixed(3)})\n${c.contenido}`
      )
      .join("\n\n---\n\n");

    const sources = topChunks.map((c) => ({
      document_id: c.document_id,
      title: c.doc_titulo || "Documento",
      doc_type: c.doc_tipo || "desconocido",
      chunk_type: c.chunk_type || "texto",
      similarity: c.finalScore,
      semantic_similarity: c.similarity,
      text_rank: c.text_rank || 0,
      scope: c.sourceScope,
      excerpt:
        (c.contenido || "").substring(0, 200) +
        ((c.contenido || "").length > 200 ? "..." : ""),
    }));

    try {
      const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Eres un asistente experto en gestion de residuos industriales en Espana. Responde basandote UNICAMENTE en el contexto proporcionado. Si no encuentras la respuesta en el contexto, dilo claramente. Cita las fuentes por numero [Fuente N].",
            },
            {
              role: "user",
              content: `Contexto:\n${context}\n\n---\nPregunta: ${query}`,
            },
          ],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (gptRes.ok) {
        const gptData = await gptRes.json();
        return NextResponse.json({
          answer: gptData.choices[0].message.content,
          sources,
          retrieval: {
            mode: "hybrid_vector_fulltext",
            candidates: rpcRows.length,
            top_k: topK,
          },
        });
      }
    } catch {
      // Fall through to text-based answer
    }

    return NextResponse.json({
      answer: `Basado en los documentos indexados, encontre la siguiente informacion relevante:\n\n${topChunks.map((c, i) => `**[Fuente ${i + 1}]** ${(c.contenido || "").substring(0, 300)}...`).join("\n\n")}`,
      sources,
      retrieval: {
        mode: "hybrid_vector_fulltext",
        candidates: rpcRows.length,
        top_k: topK,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error en consulta RAG: ${detail}` },
      { status: 500 }
    );
  }
}
