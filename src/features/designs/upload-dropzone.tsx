import { ImagePlus } from "lucide-react";
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from "react";

export interface UploadDropzoneProps {
  onFiles: (files: FileList | File[]) => void;
  children: ReactNode;
}

/**
 * Dropping an image anywhere on the page adds it.
 *
 * A media library where the way in is a button in a corner is a media library
 * nobody fills. The overlay appears only while something is genuinely being
 * dragged over the page, so it never gets in the way of reading.
 */
export function UploadDropzone({ onFiles, children }: UploadDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  // Drag events fire for every child element entered and left, so a plain
  // boolean flickers. Counting entries against exits does not.
  const depth = useRef(0);

  const carriesFiles = (event: DragEvent) =>
    event.dataTransfer?.types.includes("Files") ?? false;

  const onDragEnter = useCallback((event: DragEvent) => {
    if (!carriesFiles(event)) return;

    depth.current += 1;
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback(() => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!carriesFiles(event)) return;

      event.preventDefault();
      depth.current = 0;
      setIsDragging(false);

      if (event.dataTransfer.files.length > 0) onFiles(event.dataTransfer.files);
    },
    [onFiles],
  );

  return (
    <div
      className="relative min-h-full bg-paper-white"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      // Without preventing the default here, the browser opens the file itself.
      onDragOver={(event) => {
        if (carriesFiles(event)) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      {children}

      {isDragging ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-paper-white/90 font-paper-ui">
          <div className="flex flex-col items-center gap-3 rounded-none border-2 border-dashed border-paper-gold bg-paper-white px-12 py-10">
            <ImagePlus
              className="size-6 text-paper-char"
              strokeWidth={1.75}
              aria-hidden="true"
            />
            <p className="text-[14px] font-medium text-paper-char">Drop images or videos to add them</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
