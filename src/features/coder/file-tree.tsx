import { useState } from "react";
import { ChevronRight, ChevronDown, File, Folder, FolderOpen } from "lucide-react";
import type { FileTreeNode } from "@shared/coder-types";
import { listDirectory, readFile } from "@/lib/agentos/coder-api";
import { cn } from "@/lib/utils";

interface FileTreeProps {
  nodes: FileTreeNode[];
  onFileOpen: (path: string, content: string) => void;
  selectedPath: string | null;
}

export function FileTree({ nodes, onFileOpen, selectedPath }: FileTreeProps) {
  return (
    <div className="h-full overflow-y-auto bg-[#0a0a0a] p-2 font-mono text-sm text-[#e0e0e0]">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          level={0}
          onFileOpen={onFileOpen}
          selectedPath={selectedPath}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps {
  node: FileTreeNode;
  level: number;
  onFileOpen: (path: string, content: string) => void;
  selectedPath: string | null;
}

function FileTreeNode({ node, level, onFileOpen, selectedPath }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<FileTreeNode[]>([]);
  const [loading, setLoading] = useState(false);

  const isSelected = selectedPath === node.path;

  async function handleClick() {
    if (node.type === "directory") {
      if (!expanded && children.length === 0) {
        setLoading(true);
        try {
          const result = await listDirectory(node.path);
          if (result.success && result.nodes) {
            setChildren(result.nodes);
          }
        } catch (error) {
          console.error("Failed to load directory:", error);
        } finally {
          setLoading(false);
        }
      }
      setExpanded(!expanded);
    } else {
      try {
        const result = await readFile(node.path);
        if (result.success && result.content !== undefined) {
          onFileOpen(node.path, result.content);
        }
      } catch (error) {
        console.error("Failed to read file:", error);
      }
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        className={cn(
          "flex w-full items-center gap-1 rounded px-2 py-1 text-left transition-colors hover:bg-[#00ffcc1a]",
          isSelected && "bg-[#00ffcc33] text-[#00ffcc]"
        )}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
      >
        {node.type === "directory" ? (
          <>
            {expanded ? (
              <ChevronDown className="size-4 shrink-0" />
            ) : (
              <ChevronRight className="size-4 shrink-0" />
            )}
            {expanded ? (
              <FolderOpen className="size-4 shrink-0 text-[#00ffcc]" />
            ) : (
              <Folder className="size-4 shrink-0 text-[#00ccff]" />
            )}
          </>
        ) : (
          <>
            <span className="w-4" />
            <File className="size-4 shrink-0 text-[#6a9fb5]" />
          </>
        )}
        <span className="truncate">{node.name}</span>
        {loading && <span className="ml-auto text-xs text-[#6a9fb5]">...</span>}
      </button>

      {expanded && children.length > 0 && (
        <div>
          {children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onFileOpen={onFileOpen}
              selectedPath={selectedPath}
            />
          ))}
        </div>
      )}
    </div>
  );
}
