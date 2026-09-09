// One Markdown renderer for every place prose is shown: the AI lane, the side channel, threads,
// cards and the export preview. ```mermaid fences become diagrams, and links leave in a new tab.
// HTML in the source is escaped rather than rendered, which is what keeps a model's output from
// carrying markup into the app.
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Mermaid } from "./Mermaid";

export const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  code({ className, children }) {
    const text = String(children).replace(/\n$/, "");
    if (className === "language-mermaid") return <Mermaid source={text} />;
    return <code className={className}>{children}</code>;
  },
  a({ href, children }) {
    return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>;
  },
};

/** The rendered prose, with no wrapper of its own: the caller owns the box and its classes. */
export function Markdown({ children }: { children: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{children}</ReactMarkdown>;
}
