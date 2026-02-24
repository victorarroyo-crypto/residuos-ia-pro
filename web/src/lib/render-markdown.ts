/**
 * Shared markdown-to-HTML renderer with table support.
 * Used by the analysis report and the advisor chat.
 */

function convertMarkdownTables(text: string): string {
  // Split into lines and find contiguous table blocks (lines starting with |)
  const lines = text.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    // Detect start of a table block: line starts with |
    if (/^\|/.test(lines[i].trim())) {
      const tableLines: string[] = [];
      while (i < lines.length && /^\|/.test(lines[i].trim())) {
        tableLines.push(lines[i]);
        i++;
      }

      // Need at least header + separator + 1 data row
      if (tableLines.length >= 3 && /^[\s|:-]+$/.test(tableLines[1])) {
        const parseCells = (line: string): string[] =>
          line
            .replace(/^\|/, "")
            .replace(/\|$/, "")
            .split("|")
            .map((c) => c.trim());

        const headers = parseCells(tableLines[0]);

        // Parse alignment from separator row
        const aligns = parseCells(tableLines[1]).map((sep) => {
          if (sep.startsWith(":") && sep.endsWith(":")) return "center";
          if (sep.endsWith(":")) return "right";
          return "left";
        });

        let html =
          '<div class="overflow-x-auto my-4"><table class="min-w-full border-collapse text-sm">';

        // Header
        html += "<thead><tr>";
        headers.forEach((h, idx) => {
          const align = aligns[idx] || "left";
          html += `<th class="border border-border bg-muted px-3 py-2 font-semibold text-${align}">${h}</th>`;
        });
        html += "</tr></thead>";

        // Body rows (skip header and separator)
        html += "<tbody>";
        for (let r = 2; r < tableLines.length; r++) {
          const cells = parseCells(tableLines[r]);
          html += "<tr>";
          cells.forEach((cell, idx) => {
            const align = aligns[idx] || "left";
            html += `<td class="border border-border px-3 py-2 text-${align}">${cell}</td>`;
          });
          html += "</tr>";
        }
        html += "</tbody></table></div>";

        result.push(html);
      } else {
        // Not a real table, keep lines as-is
        result.push(...tableLines);
      }
    } else {
      result.push(lines[i]);
      i++;
    }
  }

  return result.join("\n");
}

export function renderMarkdown(text: string): string {
  // Convert tables first (before line-break replacements break the block structure)
  let html = convertMarkdownTables(text);

  html = html
    .replace(
      /^#### (.*$)/gm,
      '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>'
    )
    .replace(
      /^### (.*$)/gm,
      '<h3 class="text-base font-semibold mt-4 mb-1.5">$1</h3>'
    )
    .replace(
      /^## (.*$)/gm,
      '<h2 class="text-lg font-bold mt-5 mb-2">$1</h2>'
    )
    .replace(
      /^# (.*$)/gm,
      '<h1 class="text-xl font-bold mt-5 mb-2">$1</h1>'
    )
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.*?)\*/g, "<em>$1</em>")
    .replace(
      /`(.*?)`/g,
      '<code class="bg-muted px-1 py-0.5 rounded text-xs">$1</code>'
    )
    .replace(/^- (.*$)/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(
      /^(\d+)\. (.*$)/gm,
      '<li class="ml-4 list-decimal"><strong>$1.</strong> $2</li>'
    )
    .replace(/\n\n/g, "<br/><br/>")
    .replace(/\n/g, "<br/>");

  return html;
}
