/**
 * Export advisor responses to a branded Vandarum Word document.
 *
 * Uses the `docx` library (client-side) to build a .docx with:
 *  - Vandarum header bar (teal)
 *  - Date + title
 *  - Markdown-ish content converted to Word paragraphs
 *  - Footer with branding
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  Tab,
  TabStopPosition,
  TabStopType,
} from "docx";
import { saveAs } from "file-saver";

// Vandarum brand
const VANDARUM_TEAL = "307177";

/** Very lightweight markdown → docx paragraph converter. */
function markdownToParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = text.split("\n");

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Skip empty lines — add spacing
    if (!line) {
      paragraphs.push(new Paragraph({ spacing: { after: 120 } }));
      continue;
    }

    // Headings
    if (line.startsWith("#### ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          children: parseInline(line.slice(5)),
          spacing: { before: 200, after: 80 },
        })
      );
      continue;
    }
    if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInline(line.slice(4)),
          spacing: { before: 240, after: 100 },
        })
      );
      continue;
    }
    if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInline(line.slice(3)),
          spacing: { before: 280, after: 120 },
          thematicBreak: true,
        })
      );
      continue;
    }
    if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInline(line.slice(2)),
          spacing: { before: 320, after: 140 },
        })
      );
      continue;
    }

    // Bullet lists
    if (/^[-*] /.test(line)) {
      paragraphs.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInline(line.slice(2)),
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Numbered lists
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      paragraphs.push(
        new Paragraph({
          numbering: { reference: "advisor-numbering", level: 0 },
          children: parseInline(numMatch[2]),
          spacing: { after: 60 },
        })
      );
      continue;
    }

    // Regular paragraph
    paragraphs.push(
      new Paragraph({
        children: parseInline(line),
        spacing: { after: 80 },
      })
    );
  }

  return paragraphs;
}

/** Parse inline **bold** and *italic* markers into TextRun array. */
function parseInline(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // Match **bold**, *italic*, or plain text segments
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      runs.push(new TextRun({ text: match[1], bold: true, font: "Calibri", size: 22 }));
    } else if (match[2] !== undefined) {
      runs.push(new TextRun({ text: match[2], italics: true, font: "Calibri", size: 22 }));
    } else if (match[3] !== undefined) {
      runs.push(
        new TextRun({
          text: match[3],
          font: "Consolas",
          size: 20,
          color: VANDARUM_TEAL,
        })
      );
    } else if (match[4] !== undefined) {
      runs.push(new TextRun({ text: match[4], font: "Calibri", size: 22 }));
    }
  }

  return runs;
}

export async function exportToWord(
  answer: string,
  query: string,
  sources?: { title: string; scope: string }[]
) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "advisor-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 },
        },
        heading1: {
          run: { font: "Calibri", size: 32, bold: true, color: VANDARUM_TEAL },
        },
        heading2: {
          run: { font: "Calibri", size: 28, bold: true, color: VANDARUM_TEAL },
        },
        heading3: {
          run: { font: "Calibri", size: 24, bold: true, color: "333333" },
        },
        heading4: {
          run: { font: "Calibri", size: 22, bold: true, color: "555555" },
        },
      },
    },
    sections: [
      {
        headers: {
          default: new Header({
            children: [
              // Teal brand bar
              new Paragraph({
                alignment: AlignmentType.LEFT,
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: VANDARUM_TEAL },
                },
                spacing: { after: 200 },
                children: [
                  new TextRun({
                    text: "VANDARUM",
                    font: "Calibri",
                    size: 28,
                    bold: true,
                    color: VANDARUM_TEAL,
                  }),
                  new TextRun({
                    children: [new Tab()],
                  }),
                  new TextRun({
                    text: "Informe del Asesor IA",
                    font: "Calibri",
                    size: 20,
                    color: "666666",
                  }),
                ],
                tabStops: [
                  {
                    type: TabStopType.RIGHT,
                    position: TabStopPosition.MAX,
                  },
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                border: {
                  top: { style: BorderStyle.SINGLE, size: 2, color: VANDARUM_TEAL },
                },
                spacing: { before: 100 },
                children: [
                  new TextRun({
                    text: "Generado por ResidusIA Pro — vandarum.com",
                    font: "Calibri",
                    size: 16,
                    color: "999999",
                  }),
                ],
              }),
            ],
          }),
        },
        children: [
          // Title
          new Paragraph({
            alignment: AlignmentType.LEFT,
            spacing: { after: 80 },
            children: [
              new TextRun({
                text: "Informe Tecnico",
                font: "Calibri",
                size: 40,
                bold: true,
                color: VANDARUM_TEAL,
              }),
            ],
          }),
          // Date
          new Paragraph({
            spacing: { after: 40 },
            children: [
              new TextRun({
                text: `Fecha: ${dateStr}`,
                font: "Calibri",
                size: 20,
                color: "666666",
              }),
            ],
          }),
          // Separator
          new Paragraph({
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
            },
            spacing: { after: 200 },
          }),

          // Consulta
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: "Consulta", font: "Calibri", size: 28, bold: true, color: VANDARUM_TEAL })],
            spacing: { after: 100 },
          }),
          new Paragraph({
            children: [new TextRun({ text: query, font: "Calibri", size: 22, italics: true })],
            spacing: { after: 240 },
          }),

          // Respuesta
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            children: [new TextRun({ text: "Analisis y Recomendaciones", font: "Calibri", size: 28, bold: true, color: VANDARUM_TEAL })],
            spacing: { after: 120 },
          }),
          ...markdownToParagraphs(answer),

          // Sources section (if any)
          ...(sources && sources.length > 0
            ? [
                new Paragraph({ spacing: { before: 300, after: 100 } }),
                new Paragraph({
                  heading: HeadingLevel.HEADING_2,
                  children: [new TextRun({ text: "Fuentes Consultadas", font: "Calibri", size: 28, bold: true, color: VANDARUM_TEAL })],
                  spacing: { after: 80 },
                }),
                ...sources.map(
                  (s) =>
                    new Paragraph({
                      bullet: { level: 0 },
                      children: [
                        new TextRun({
                          text: s.title,
                          font: "Calibri",
                          size: 20,
                        }),
                        new TextRun({
                          text: ` (${s.scope === "general" ? "Base de Conocimiento" : s.scope === "web" ? "Web" : "Proyecto"})`,
                          font: "Calibri",
                          size: 18,
                          color: "999999",
                        }),
                      ],
                    })
                ),
              ]
            : []),

          // Disclaimer
          new Paragraph({ spacing: { before: 400, after: 80 } }),
          new Paragraph({
            border: {
              top: { style: BorderStyle.SINGLE, size: 1, color: "DDDDDD" },
            },
            spacing: { before: 100 },
            children: [
              new TextRun({
                text: "Nota: Este informe ha sido generado por inteligencia artificial como herramienta de apoyo profesional. Las recomendaciones deben ser validadas por un tecnico cualificado antes de su aplicacion.",
                font: "Calibri",
                size: 18,
                color: "999999",
                italics: true,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const filename = `Vandarum_Informe_${now.toISOString().slice(0, 10)}.docx`;
  saveAs(blob, filename);
}
