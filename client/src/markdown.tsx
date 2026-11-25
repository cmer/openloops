import type { ReactNode } from "react";

/** Light markdown: paragraphs, line breaks, **bold**, *italic*, `code`, - / * lists, [label](https://…).
 *  A paragraph starting "What you need to do:" is boxed. No HTML, headings or images. */
export function Markdown({ text }: { text: string | null }) {
  if (!text?.trim()) return <p className="ol-md-empty">No notes.</p>;
  const blocks = text.replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  return (
    <div className="ol-md sensitive">
      {blocks.map((block, index) => {
        const lines = block.split("\n").filter((line) => line.trim());
        if (lines.length > 0 && lines.every((line) => /^[-*] /.test(line.trim()))) {
          return (
            <ul key={index}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>{inline(line.trim().replace(/^[-*] /, ""), `${index}-${lineIndex}`)}</li>
              ))}
            </ul>
          );
        }
        const todo = block.match(/^What you need to do:\s*/i);
        if (todo) {
          return (
            <p key={index} className="ol-todo">
              <strong>What you need to do:</strong> {withBreaks(block.slice(todo[0].length), `p-${index}`)}
            </p>
          );
        }
        return <p key={index}>{withBreaks(block, `p-${index}`)}</p>;
      })}
    </div>
  );
}

function withBreaks(text: string, key: string): ReactNode[] {
  return text.split("\n").flatMap((line, index) => {
    const parts = inline(line, `${key}-${index}`);
    return index > 0 ? [<br key={`${key}-br-${index}`} />, ...parts] : parts;
  });
}

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0;
  let index = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > last) nodes.push(text.slice(last, start));
    const token = match[0];
    const key = `${keyPrefix}-${index++}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (link) {
        nodes.push(
          <a key={key} href={link[2]} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            {link[1]}
          </a>,
        );
      }
    }
    last = start + token.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}
