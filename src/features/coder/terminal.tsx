import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { coderWebSocketUrl } from "@/lib/agentos/coder-api";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  terminalId: string;
  token: string;
  onExit?: () => void;
}

export function Terminal({ terminalId, token, onExit }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new XTerm({
      theme: {
        background: "#0a0a0a",
        foreground: "#e0e0e0",
        cursor: "#00ffcc",
        cursorAccent: "#0a0a0a",
        selectionBackground: "#00ffcc33",
        selectionForeground: "#e0e0e0",
        black: "#0a0a0a",
        red: "#ff0066",
        green: "#00ffcc",
        yellow: "#ffff00",
        blue: "#00ccff",
        magenta: "#ff00ff",
        cyan: "#00ffcc",
        white: "#e0e0e0",
        brightBlack: "#6a9fb5",
        brightRed: "#ff3388",
        brightGreen: "#33ffdd",
        brightYellow: "#ffff66",
        brightBlue: "#66ddff",
        brightMagenta: "#ff66ff",
        brightCyan: "#66ffdd",
        brightWhite: "#ffffff",
      },
      fontFamily: "'IBM Plex Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminal.open(containerRef.current);
    fitAddon.fit();

    fitAddonRef.current = fitAddon;
    terminalRef.current = terminal;

    const ws = new WebSocket(coderWebSocketUrl(token));

    ws.onopen = () => {
      terminal.write("\x1b[32m● Connected to terminal\x1b[0m\r\n");
      
      ws.send(JSON.stringify({
        type: "resize",
        cols: terminal.cols,
        rows: terminal.rows,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === "data") {
          terminal.write(message.data);
        } else if (message.type === "exit") {
          terminal.write("\r\n\x1b[31m● Terminal exited\x1b[0m\r\n");
          onExit?.();
        }
      } catch (error) {
        console.error("Failed to parse terminal message:", error);
      }
    };

    ws.onerror = (error) => {
      console.error("Terminal WebSocket error:", error);
      terminal.write("\r\n\x1b[31m● Connection error\x1b[0m\r\n");
    };

    ws.onclose = () => {
      terminal.write("\r\n\x1b[31m● Disconnected\x1b[0m\r\n");
    };

    wsRef.current = ws;

    const disposable = terminal.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "input", data }));
      }
    });

    terminal.onResize((size) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "resize",
          cols: size.cols,
          rows: size.rows,
        }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      disposable.dispose();
      resizeObserver.disconnect();
      ws.close();
      terminal.dispose();
    };
  }, [terminalId, token, onExit]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full bg-[#0a0a0a]"
      style={{
        padding: "8px",
      }}
    />
  );
}
