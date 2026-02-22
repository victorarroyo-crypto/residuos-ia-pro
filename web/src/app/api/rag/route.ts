import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { loadEnv } from "@/lib/env";

export async function POST(request: NextRequest) {
  const admin = getAdminClient();
  if (!admin.ok) {
    return NextResponse.json({ error: admin.detail }, { status: admin.status });
  }

  try {
    const body = await request.json();
    const query = body.query as string;
    const topK = (body.top_k as number) || 5;

    if (!query) {
      return NextResponse.json(
        { error: "Se requiere un campo 'query'" },
        { status: 400 }
      );
    }

    const sb = admin.client;

    // Text-based search across document_chunks
    const searchTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2)
      .slice(0, 8);

    // Search chunks using ilike for each significant term
    const scope = (body.scope as string) || "general";
    const projectId = body.project_id as string | undefined;

    let chunkQuery = sb
      .from("document_chunks")
      .select("id, document_id, contenido, chunk_type, metadata")
      .eq("rag_scope", scope)
      .limit(topK * 3);

    // For project scope, filter by project ownership
    if (scope === "project" && projectId) {
      const { data: projectDocs } = await sb
        .from("client_documents")
        .select("id")
        .eq("project_id", projectId);
      const docIds = (projectDocs || []).map((d) => d.id);
      if (docIds.length > 0) {
        chunkQuery = chunkQuery.in("document_id", docIds);
      } else {
        // No docs for this project → empty result
        return NextResponse.json({
          answer: "No hay documentos indexados para este proyecto.",
          sources: [],
        });
      }
    }

    if (searchTerms.length > 0) {
      // Use OR filter matching any term
      const orFilters = searchTerms
        .map((term) => `contenido.ilike.%${term}%`)
        .join(",");
      chunkQuery = chunkQuery.or(orFilters);
    }

    const { data: chunks } = await chunkQuery.limit(topK * 3);

    if (!chunks || chunks.length === 0) {
      return NextResponse.json({
        answer:
          "No encontre informacion relevante en la base de conocimiento para esta consulta. Intenta reformular la pregunta o verifica que hay documentos indexados.",
        sources: [],
      });
    }

    // Score chunks by how many terms they match
    const scored = (chunks || []).map((chunk) => {
      const lower = (chunk.contenido || "").toLowerCase();
      const hits = searchTerms.filter((t) => lower.includes(t)).length;
      return { ...chunk, score: hits / Math.max(searchTerms.length, 1) };
    });
    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.slice(0, topK);

    // Get document titles for sources
    const docIds = Array.from(new Set(topChunks.map((c) => c.document_id)));
    const { data: docs } = await sb
      .from("client_documents")
      .select("id, titulo, tipo")
      .in("id", docIds);

    const docMap = new Map(
      (docs || []).map((d) => [d.id, { titulo: d.titulo, tipo: d.tipo }])
    );

    // Build context and sources
    const context = topChunks
      .map(
        (c, i) =>
          `[Fuente ${i + 1}] ${docMap.get(c.document_id)?.titulo || "Documento"}\n${c.contenido}`
      )
      .join("\n\n---\n\n");

    const sources = topChunks.map((c) => ({
      document_id: c.document_id,
      title: docMap.get(c.document_id)?.titulo || "Documento",
      doc_type: docMap.get(c.document_id)?.tipo || "desconocido",
      chunk_type: c.chunk_type || "texto",
      similarity: c.score,
      scope,
      excerpt:
        (c.contenido || "").substring(0, 200) +
        ((c.contenido || "").length > 200 ? "..." : ""),
    }));

    // If OpenAI key is available, use GPT to synthesize an answer
    const openaiKey = loadEnv("OPENAI_API_KEY");
    if (openaiKey) {
      try {
        const gptRes = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
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
                  content: `Eres un asistente experto en gestion de residuos industriales en Espana. Responde basandote UNICAMENTE en el contexto proporcionado. Si no encuentras la respuesta en el contexto, dilo claramente. Cita las fuentes por numero [Fuente N].`,
                },
                {
                  role: "user",
                  content: `Contexto:\n${context}\n\n---\nPregunta: ${query}`,
                },
              ],
              temperature: 0.3,
              max_tokens: 1000,
            }),
          }
        );

        if (gptRes.ok) {
          const gptData = await gptRes.json();
          return NextResponse.json({
            answer: gptData.choices[0].message.content,
            sources,
          });
        }
      } catch {
        // Fall through to text-based answer
      }
    }

    // Fallback: return raw context
    return NextResponse.json({
      answer: `Basado en los documentos indexados, encontre la siguiente informacion relevante:\n\n${topChunks.map((c, i) => `**[Fuente ${i + 1}]** ${(c.contenido || "").substring(0, 300)}...`).join("\n\n")}`,
      sources,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: `Error en consulta RAG: ${detail}` },
      { status: 500 }
    );
  }
}
