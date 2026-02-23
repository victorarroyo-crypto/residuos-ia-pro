import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { loadEnv } from "@/lib/env";

type RpcChunk = {
  chunk_id: string;
  document_id: string;
  contenido: string;
  chunk_type: string;
  similarity: number;
  doc_titulo: string;
  doc_tipo: string;
  source?: string;
};

type RankedChunk = RpcChunk & {
  lexicalScore: number;
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

function lexicalScore(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const lower = (text || "").toLowerCase();
  const hits = terms.filter((t) => lower.includes(t)).length;
  return hits / terms.length;
}

export async function POST(request: NextRequest) {
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
    const searchTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 10);

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
      });
      if (error) throw new Error(error.message);
      rpcRows = (data || []) as RpcChunk[];
    } else {
      const { data, error } = await sb.rpc("search_knowledge", {
        query_embedding: queryEmbedding,
        doc_type_filter: null,
        match_threshold: threshold,
        match_count: candidateLimit,
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

    // Re-ranking ligero: mezcla de score semántico (vector) + score léxico (términos).
    const ranked: RankedChunk[] = rpcRows.map((row) => {
      const lex = lexicalScore(row.contenido || "", searchTerms);
      const sem = Number.isFinite(row.similarity) ? row.similarity : 0;
      return {
        ...row,
        lexicalScore: lex,
        finalScore: sem * 0.8 + lex * 0.2,
        sourceScope:
          scope === "combined"
            ? cSourceToScope(row.source)
            : scope,
      };
    });

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
      lexical_similarity: c.lexicalScore,
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
            mode: "semantic_with_rerank",
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
        mode: "semantic_with_rerank",
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
