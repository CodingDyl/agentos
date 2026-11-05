import { useRef } from "react";
import Editor, { loader, type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import * as monaco from "monaco-editor";

loader.config({ monaco });

interface CodeEditorProps {
  value: string;
  path: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export function CodeEditor({ value, path, onChange, onSave }: CodeEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const language = getLanguageFromPath(path);

  function handleEditorDidMount(editor: editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = editor;

    monaco.editor.defineTheme("quiet-terminal", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "8E99A5" },
        { token: "keyword", foreground: "9DDBBD" },
        { token: "string", foreground: "D3C4F0" },
        { token: "number", foreground: "E8C58A" },
        { token: "type", foreground: "B0D6FF" },
        { token: "function", foreground: "9DDBBD" },
      ],
      colors: {
        "editor.background": "#111315",
        "editor.foreground": "#EEF1F4",
        "editor.lineHighlightBackground": "#1A1E22",
        "editorCursor.foreground": "#9DDBBD",
        "editor.selectionBackground": "#273B34",
        "editor.inactiveSelectionBackground": "#22272D",
      },
    });

    monaco.editor.setTheme("quiet-terminal");

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave();
    });
  }

  function handleChange(value: string | undefined) {
    onChange(value ?? "");
  }

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        language={language}
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme="quiet-terminal"
        options={{
          fontSize: 14,
          fontFamily: "'Geist Mono Variable', 'JetBrains Mono', Menlo, monospace",
          minimap: { enabled: true },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          insertSpaces: true,
          wordWrap: "on",
          lineNumbers: "on",
          renderWhitespace: "selection",
          bracketPairColorization: {
            enabled: true,
          },
        }}
      />
    </div>
  );
}

function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    md: "markdown",
    css: "css",
    scss: "scss",
    html: "html",
    xml: "xml",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    sql: "sql",
    php: "php",
    swift: "swift",
    kt: "kotlin",
    dockerfile: "dockerfile",
  };

  return languageMap[ext ?? ""] ?? "plaintext";
}
