import { useRef } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

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

    monaco.editor.defineTheme("dedsec", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6a9fb5" },
        { token: "keyword", foreground: "00ffcc" },
        { token: "string", foreground: "ff00ff" },
        { token: "number", foreground: "ffff00" },
        { token: "type", foreground: "00ccff" },
        { token: "function", foreground: "00ffcc" },
      ],
      colors: {
        "editor.background": "#0a0a0a",
        "editor.foreground": "#e0e0e0",
        "editor.lineHighlightBackground": "#141414",
        "editorCursor.foreground": "#00ffcc",
        "editor.selectionBackground": "#00ffcc33",
        "editor.inactiveSelectionBackground": "#00ffcc1a",
      },
    });

    monaco.editor.setTheme("dedsec");

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
        theme="dedsec"
        options={{
          fontSize: 14,
          fontFamily: "'IBM Plex Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
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
