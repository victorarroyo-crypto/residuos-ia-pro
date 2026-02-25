/**
 * Export advisor responses to a professionally branded Vandarum Word document.
 *
 * Based on the Manual de Marca Vandarum (Oct 2025):
 *  - Brand colors: Verde Oscuro #307177, Verde Claro #8cb63c, Azul #32b4cd, Naranja #ffa720
 *  - Typography: Calibri Light (titles), Calibri (body) — closest system fonts to Helvetica Neue / Proxima Nova
 *  - Professional layout: cover page, logo header, page numbers, branded tables
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  HeadingLevel,
  AlignmentType,
  BorderStyle,
  Footer,
  Header,
  Tab,
  TabStopPosition,
  TabStopType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  PageNumber,
  NumberFormat,
  SectionType,
  PageBreak,
  ShadingType,
  VerticalAlign,
  TableLayoutType,
} from "docx";
import { saveAs } from "file-saver";
import { VANDARUM_LOGO_BASE64 } from "./vandarum-logo-data";

// ─── Brand constants from Manual de Marca ────────────────────────

const BRAND = {
  verdeOscuro: "307177",
  verdeClaro: "8cb63c",
  azul: "32b4cd",
  naranja: "ffa720",
  grisOscuro: "333333",
  grisMedio: "666666",
  grisClaro: "999999",
  grisMuyClaro: "DDDDDD",
  blanco: "FFFFFF",
} as const;

const FONT = {
  title: "Calibri Light",   // Closest to Helvetica Neue LT Pro 55 Roman
  titleBold: "Calibri",     // Closest to Helvetica Neue LT Pro 77 Bold
  body: "Calibri",          // Closest to Proxima Nova Regular
  code: "Consolas",
} as const;

// ─── Logo helper ─────────────────────────────────────────────────

function getLogoBuffer(): Buffer {
  return Buffer.from(VANDARUM_LOGO_BASE64, "base64");
}

// ─── Markdown → Paragraphs converter ─────────────────────────────

/** Parse inline **bold**, *italic*, `code` markers into TextRun array. */
function parseInline(text: string, fontSize = 22, fontName = FONT.body): TextRun[] {
  const runs: TextRun[] = [];
  const regex = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|([^*`]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[1] !== undefined) {
      runs.push(new TextRun({ text: match[1], bold: true, font: fontName, size: fontSize }));
    } else if (match[2] !== undefined) {
      runs.push(new TextRun({ text: match[2], italics: true, font: fontName, size: fontSize }));
    } else if (match[3] !== undefined) {
      runs.push(new TextRun({ text: match[3], font: FONT.code, size: fontSize - 2, color: BRAND.verdeOscuro }));
    } else if (match[4] !== undefined) {
      runs.push(new TextRun({ text: match[4], font: fontName, size: fontSize }));
    }
  }

  return runs;
}

/** Parse a markdown table block into a docx Table with branded styling. */
function parseMarkdownTable(lines: string[]): Table | null {
  if (lines.length < 2) return null;

  // Parse header
  const headerCells = lines[0]
    .split("|")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);

  // Skip separator line (line 1: |---|---|)
  // Parse body rows
  const bodyRows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i]
      .split("|")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (cells.length > 0) bodyRows.push(cells);
  }

  const colCount = headerCells.length;
  if (colCount === 0) return null;

  // Build table
  const rows: TableRow[] = [];

  // Header row with brand teal background
  rows.push(
    new TableRow({
      tableHeader: true,
      children: headerCells.map(
        (cell) =>
          new TableCell({
            shading: { type: ShadingType.SOLID, color: BRAND.verdeOscuro, fill: BRAND.verdeOscuro },
            verticalAlign: VerticalAlign.CENTER,
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                spacing: { before: 40, after: 40 },
                children: [
                  new TextRun({
                    text: cell,
                    font: FONT.titleBold,
                    size: 20,
                    bold: true,
                    color: BRAND.blanco,
                  }),
                ],
              }),
            ],
          })
      ),
    })
  );

  // Body rows with alternating shading
  bodyRows.forEach((row, rowIdx) => {
    const shadeBg = rowIdx % 2 === 0 ? "F5F9F9" : BRAND.blanco;
    const cells: TableCell[] = [];
    for (let c = 0; c < colCount; c++) {
      cells.push(
        new TableCell({
          shading: { type: ShadingType.SOLID, color: shadeBg, fill: shadeBg },
          verticalAlign: VerticalAlign.CENTER,
          children: [
            new Paragraph({
              spacing: { before: 30, after: 30 },
              children: parseInline(row[c] || "", 20),
            }),
          ],
        })
      );
    }
    rows.push(new TableRow({ children: cells }));
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    rows,
  });
}

/** Convert markdown text to an array of docx paragraphs and tables. */
function markdownToDocxElements(text: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trimEnd();

    // Detect table blocks (lines starting with |)
    if (line.startsWith("|") && line.includes("|", 1)) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimEnd().startsWith("|")) {
        tableLines.push(lines[i].trimEnd());
        i++;
      }
      const table = parseMarkdownTable(tableLines);
      if (table) {
        elements.push(new Paragraph({ spacing: { before: 120, after: 120 } }));
        elements.push(table);
        elements.push(new Paragraph({ spacing: { after: 120 } }));
      }
      continue;
    }

    // Empty lines
    if (!line) {
      elements.push(new Paragraph({ spacing: { after: 80 } }));
      i++;
      continue;
    }

    // Headings with teal brand color
    if (line.startsWith("#### ")) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_4,
          children: parseInline(line.slice(5), 22, FONT.titleBold),
          spacing: { before: 200, after: 80 },
        })
      );
      i++;
      continue;
    }
    if (line.startsWith("### ")) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_3,
          children: parseInline(line.slice(4), 24, FONT.titleBold),
          spacing: { before: 240, after: 100 },
        })
      );
      i++;
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: parseInline(line.slice(3), 28, FONT.titleBold),
          spacing: { before: 280, after: 120 },
          thematicBreak: true,
        })
      );
      i++;
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: parseInline(line.slice(2), 32, FONT.titleBold),
          spacing: { before: 320, after: 140 },
        })
      );
      i++;
      continue;
    }

    // Horizontal rule → teal separator line
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BRAND.verdeOscuro } },
          spacing: { before: 120, after: 120 },
        })
      );
      i++;
      continue;
    }

    // Bullet lists (- or *)
    if (/^[-*] /.test(line)) {
      elements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: parseInline(line.slice(2)),
          spacing: { after: 60 },
        })
      );
      i++;
      continue;
    }

    // Nested bullets (  - or  *)
    if (/^\s{2,}[-*] /.test(line)) {
      const content = line.replace(/^\s+[-*] /, "");
      elements.push(
        new Paragraph({
          bullet: { level: 1 },
          children: parseInline(content),
          spacing: { after: 50 },
        })
      );
      i++;
      continue;
    }

    // Numbered lists
    const numMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numMatch) {
      elements.push(
        new Paragraph({
          numbering: { reference: "vandarum-numbering", level: 0 },
          children: parseInline(numMatch[2]),
          spacing: { after: 60 },
        })
      );
      i++;
      continue;
    }

    // Regular paragraph
    elements.push(
      new Paragraph({
        children: parseInline(line),
        spacing: { after: 80 },
      })
    );
    i++;
  }

  return elements;
}

// ─── Build header with logo ──────────────────────────────────────

function buildHeader(reportType: string): Header {
  const logoBuffer = getLogoBuffer();

  return new Header({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, color: BRAND.verdeOscuro },
        },
        spacing: { after: 200 },
        children: [
          new ImageRun({
            data: logoBuffer,
            transformation: { width: 100, height: 69 },
            type: "png",
          }),
          new TextRun({ children: [new Tab()] }),
          new TextRun({
            text: reportType,
            font: FONT.title,
            size: 20,
            color: BRAND.grisMedio,
          }),
        ],
        tabStops: [
          { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
        ],
      }),
    ],
  });
}

// ─── Build footer with page numbers ──────────────────────────────

function buildFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: {
          top: { style: BorderStyle.SINGLE, size: 2, color: BRAND.verdeOscuro },
        },
        spacing: { before: 100 },
        children: [
          new TextRun({
            text: "Generado por ResidusIA Pro  —  vandarum.com",
            font: FONT.body,
            size: 16,
            color: BRAND.grisClaro,
          }),
          new TextRun({ children: [new Tab()] }),
          new TextRun({
            font: FONT.body,
            size: 16,
            color: BRAND.grisClaro,
            children: [PageNumber.CURRENT],
          }),
          new TextRun({
            text: " / ",
            font: FONT.body,
            size: 16,
            color: BRAND.grisClaro,
          }),
          new TextRun({
            font: FONT.body,
            size: 16,
            color: BRAND.grisClaro,
            children: [PageNumber.TOTAL_PAGES],
          }),
        ],
        tabStops: [
          { type: TabStopType.RIGHT, position: TabStopPosition.MAX },
        ],
      }),
    ],
  });
}

// ─── Cover page section ──────────────────────────────────────────

function buildCoverPage(
  title: string,
  subtitle: string,
  dateStr: string,
  projectName?: string
): Paragraph[] {
  const logoBuffer = getLogoBuffer();
  const children: Paragraph[] = [];

  // Spacing at top
  children.push(new Paragraph({ spacing: { before: 1600 } }));

  // Logo centered
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      children: [
        new ImageRun({
          data: logoBuffer,
          transformation: { width: 200, height: 138 },
          type: "png",
        }),
      ],
    })
  );

  // Main title
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 160 },
      children: [
        new TextRun({
          text: title,
          font: FONT.titleBold,
          size: 52,
          bold: true,
          color: BRAND.verdeOscuro,
        }),
      ],
    })
  );

  // Teal accent line
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [
        new TextRun({
          text: "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
          font: FONT.body,
          size: 16,
          color: BRAND.verdeOscuro,
        }),
      ],
    })
  );

  // Subtitle / query
  if (subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        children: [
          new TextRun({
            text: subtitle,
            font: FONT.title,
            size: 28,
            color: BRAND.grisMedio,
            italics: true,
          }),
        ],
      })
    );
  }

  // Project name if provided
  if (projectName) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 80 },
        children: [
          new TextRun({
            text: `Proyecto: ${projectName}`,
            font: FONT.body,
            size: 24,
            color: BRAND.verdeOscuro,
          }),
        ],
      })
    );
  }

  // Date
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 80 },
      children: [
        new TextRun({
          text: dateStr,
          font: FONT.body,
          size: 22,
          color: BRAND.grisMedio,
        }),
      ],
    })
  );

  // Push company info toward bottom
  children.push(new Paragraph({ spacing: { before: 2000 } }));

  // Company info block
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: "Vandarum SL",
          font: FONT.titleBold,
          size: 20,
          bold: true,
          color: BRAND.verdeOscuro,
        }),
      ],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 20 },
      children: [
        new TextRun({
          text: "C/ Santisima Trinidad, 22, 28010 Madrid",
          font: FONT.body,
          size: 18,
          color: BRAND.grisClaro,
        }),
      ],
    })
  );
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
      children: [
        new TextRun({
          text: "vandarum.com",
          font: FONT.body,
          size: 18,
          color: BRAND.verdeOscuro,
        }),
      ],
    })
  );

  // Confidentiality note
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 },
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: BRAND.grisMuyClaro },
      },
      children: [
        new TextRun({
          text: "Documento confidencial. Uso exclusivo del destinatario.",
          font: FONT.body,
          size: 16,
          color: BRAND.grisClaro,
          italics: true,
        }),
      ],
    })
  );

  return children;
}

// ─── Main export function ────────────────────────────────────────

export interface ExportWordOptions {
  answer: string;
  query: string;
  sources?: { title: string; scope: string }[];
  projectName?: string;
  reportTitle?: string;
}

export async function exportToWord(
  answer: string,
  query: string,
  sources?: { title: string; scope: string }[],
  projectName?: string,
  reportTitle?: string
) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const title = reportTitle || "Informe Tecnico";
  const headerLabel = "Informe del Asesor IA";

  // ─── Build content paragraphs ────────────────────────────────

  const contentElements: (Paragraph | Table)[] = [];

  // Section: Consulta
  contentElements.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: "Consulta",
          font: FONT.titleBold,
          size: 28,
          bold: true,
          color: BRAND.verdeOscuro,
        }),
      ],
      spacing: { after: 100 },
    })
  );
  contentElements.push(
    new Paragraph({
      children: [
        new TextRun({
          text: query,
          font: FONT.body,
          size: 22,
          italics: true,
          color: BRAND.grisOscuro,
        }),
      ],
      spacing: { after: 240 },
      border: {
        left: { style: BorderStyle.SINGLE, size: 8, color: BRAND.verdeClaro },
      },
      indent: { left: 200 },
    })
  );

  // Section: Analisis y Recomendaciones
  contentElements.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [
        new TextRun({
          text: "Analisis y Recomendaciones",
          font: FONT.titleBold,
          size: 28,
          bold: true,
          color: BRAND.verdeOscuro,
        }),
      ],
      spacing: { after: 120 },
    })
  );
  contentElements.push(...markdownToDocxElements(answer));

  // Section: Fuentes Consultadas
  if (sources && sources.length > 0) {
    contentElements.push(new Paragraph({ spacing: { before: 300, after: 100 } }));
    contentElements.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [
          new TextRun({
            text: "Fuentes Consultadas",
            font: FONT.titleBold,
            size: 28,
            bold: true,
            color: BRAND.verdeOscuro,
          }),
        ],
        spacing: { after: 80 },
      })
    );

    for (const s of sources) {
      const scopeLabel =
        s.scope === "general"
          ? "Base de Conocimiento"
          : s.scope === "web"
            ? "Web"
            : "Proyecto";
      const scopeColor =
        s.scope === "web" ? BRAND.azul : s.scope === "general" ? BRAND.verdeOscuro : BRAND.verdeClaro;

      contentElements.push(
        new Paragraph({
          bullet: { level: 0 },
          children: [
            new TextRun({
              text: s.title,
              font: FONT.body,
              size: 20,
            }),
            new TextRun({
              text: `  [${scopeLabel}]`,
              font: FONT.body,
              size: 18,
              color: scopeColor,
              italics: true,
            }),
          ],
        })
      );
    }
  }

  // Disclaimer
  contentElements.push(new Paragraph({ spacing: { before: 400, after: 80 } }));
  contentElements.push(
    new Paragraph({
      border: {
        top: { style: BorderStyle.SINGLE, size: 1, color: BRAND.grisMuyClaro },
      },
      spacing: { before: 100, after: 40 },
      children: [
        new TextRun({
          text: "Nota: ",
          font: FONT.body,
          size: 18,
          color: BRAND.grisClaro,
          bold: true,
          italics: true,
        }),
        new TextRun({
          text: "Este informe ha sido generado por inteligencia artificial como herramienta de apoyo profesional. Las recomendaciones deben ser validadas por un tecnico cualificado antes de su aplicacion.",
          font: FONT.body,
          size: 18,
          color: BRAND.grisClaro,
          italics: true,
        }),
      ],
    })
  );

  // ─── Assemble document ───────────────────────────────────────

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: "vandarum-numbering",
          levels: [
            {
              level: 0,
              format: NumberFormat.DECIMAL,
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
          run: { font: FONT.body, size: 22, color: BRAND.grisOscuro },
        },
        heading1: {
          run: { font: FONT.titleBold, size: 32, bold: true, color: BRAND.verdeOscuro },
        },
        heading2: {
          run: { font: FONT.titleBold, size: 28, bold: true, color: BRAND.verdeOscuro },
        },
        heading3: {
          run: { font: FONT.titleBold, size: 24, bold: true, color: BRAND.grisOscuro },
        },
        heading4: {
          run: { font: FONT.titleBold, size: 22, bold: true, color: BRAND.grisMedio },
        },
      },
    },
    sections: [
      // ── Section 1: Cover page (no header/footer) ─────────
      {
        properties: {
          titlePage: true,
          page: {
            margin: { top: 720, bottom: 720, left: 1200, right: 1200 },
            pageNumbers: { start: 0 },
          },
        },
        headers: {
          default: new Header({ children: [new Paragraph({})] }),
          first: new Header({ children: [new Paragraph({})] }),
        },
        footers: {
          default: new Footer({ children: [new Paragraph({})] }),
          first: new Footer({ children: [new Paragraph({})] }),
        },
        children: buildCoverPage(title, query, dateStr, projectName),
      },
      // ── Section 2: Content pages (with branded header/footer) ──
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: {
            margin: { top: 1440, bottom: 1080, left: 1200, right: 1200 },
            pageNumbers: { start: 1 },
          },
        },
        headers: { default: buildHeader(headerLabel) },
        footers: { default: buildFooter() },
        children: contentElements as Paragraph[],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const safeName = projectName
    ? projectName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)
    : "";
  const filename = safeName
    ? `Vandarum_Informe_${safeName}_${now.toISOString().slice(0, 10)}.docx`
    : `Vandarum_Informe_${now.toISOString().slice(0, 10)}.docx`;
  saveAs(blob, filename);
}
