import { useEffect, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link,
  List,
  ListOrdered,
  Pilcrow,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline,
  Undo2,
  Unlink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLanguage } from "@/lib/i18n";
import { useToast } from "@/hooks/use-toast";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  compilationId: number;
  onUploadingChange?: (isUploading: boolean) => void;
}

const RICH_TEXT_MARKER = "<!--idea-stream-rich-text-->";
const ALLOWED_TAGS = new Set([
  "p", "br", "h1", "h2", "h3", "strong", "b", "em", "i", "u", "s",
  "strike", "ul", "ol", "li", "blockquote", "a", "img", "span", "div", "font", "mark",
]);

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function normalizeDraftHtml(value: string) {
  if (!value) return "";
  if (value.startsWith(RICH_TEXT_MARKER)) {
    return value.slice(RICH_TEXT_MARKER.length);
  }

  return value
    .split(/\n{2,}/)
    .map((paragraph) => {
      const escaped = escapeHtml(paragraph).replace(/\n/g, "<br>");
      if (escaped.startsWith("### ")) return `<h3>${escaped.slice(4)}</h3>`;
      if (escaped.startsWith("## ")) return `<h2>${escaped.slice(3)}</h2>`;
      if (escaped.startsWith("# ")) return `<h1>${escaped.slice(2)}</h1>`;
      return `<p>${escaped}</p>`;
    })
    .join("");
}

export function sanitizeDraftHtml(value: string) {
  if (typeof window === "undefined") return value;
  const documentValue = new DOMParser().parseFromString(value, "text/html");
  documentValue.body.querySelectorAll("*").forEach((element) => {
    const tag = element.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      if (["script", "style", "iframe", "object", "embed", "form"].includes(tag)) {
        element.remove();
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      return;
    }

    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const allowedByTag =
        (name === "dir" && ["ltr", "rtl"].includes(attribute.value)) ||
        (tag === "a" && name === "href") ||
        (tag === "img" && ["src", "alt"].includes(name)) ||
        (tag === "font" && ["face", "size", "color"].includes(name)) ||
        (name === "style");
      if (!allowedByTag) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element.hasAttribute("style")) {
      const allowedStyles = Array.from((element as HTMLElement).style)
        .filter((property) => [
          "text-align", "color", "background-color", "border-radius", "padding", "font-family", "font-size",
          "width", "max-width", "height", "display", "float",
          "margin", "margin-top", "margin-bottom", "margin-left", "margin-right",
        ].includes(property))
        .map((property) => `${property}: ${(element as HTMLElement).style.getPropertyValue(property)}`)
        .join("; ");
      if (allowedStyles) element.setAttribute("style", allowedStyles);
      else element.removeAttribute("style");
    }

    if (tag === "a") {
      const href = element.getAttribute("href");
      try {
        const url = new URL((href || "").replace(/[\u0000-\u0020\u007f]+/g, ""), window.location.origin);
        if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsafe link");
        element.setAttribute("href", url.href);
        element.setAttribute("target", "_blank");
        element.setAttribute("rel", "noopener noreferrer");
      } catch {
        element.removeAttribute("href");
      }
    }

    if (tag === "img") {
      const src = element.getAttribute("src") || "";
      try {
        const url = new URL(src.replace(/[\u0000-\u0020\u007f]+/g, ""), window.location.origin);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          (url.origin === window.location.origin && !url.pathname.startsWith("/api/storage/objects/"))
        ) {
          throw new Error("Unsafe image");
        }
        element.setAttribute("src", url.origin === window.location.origin ? `${url.pathname}${url.search}` : url.href);
      } catch {
        element.remove();
      }
    }
  });
  return documentValue.body.innerHTML;
}

function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-11 w-11 shrink-0 sm:h-8 sm:w-8"
      title={label}
      aria-label={label}
      data-testid={`editor-${label.toLowerCase().replace(/\s+/g, "-")}`}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

export function RichTextEditor({
  value,
  onChange,
  compilationId,
  onUploadingChange,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const lastEmittedValueRef = useRef("");
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [selectedImage, setSelectedImage] = useState<HTMLImageElement | null>(null);
  const [customImageWidth, setCustomImageWidth] = useState(100);
  const { t } = useLanguage();
  const { toast } = useToast();

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (value === lastEmittedValueRef.current) return;
    const nextValue = sanitizeDraftHtml(normalizeDraftHtml(value));
    if (editor.innerHTML !== nextValue) {
      editor.innerHTML = nextValue;
      historyRef.current = [nextValue];
      historyIndexRef.current = 0;
    } else if (historyIndexRef.current < 0) {
      historyRef.current = [nextValue];
      historyIndexRef.current = 0;
    }
  }, [value]);

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;

    const html = editor.innerHTML;
    const current = historyRef.current[historyIndexRef.current];
    if (html !== current) {
      historyRef.current = historyRef.current.slice(
        0,
        historyIndexRef.current + 1,
      );
      historyRef.current.push(html);
      historyIndexRef.current = historyRef.current.length - 1;
    }
    const nextValue = `${RICH_TEXT_MARKER}${html}`;
    lastEmittedValueRef.current = nextValue;
    onChange(nextValue);
  };

  const rememberSelection = () => {
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      editorRef.current?.contains(selection.anchorNode)
    ) {
      selectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (!selectionRef.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectionRef.current);
  };

  const command = (name: string, commandValue?: string) => {
    editorRef.current?.focus();
    restoreSelection();
    document.execCommand(name, false, commandValue);
    emitChange();
    rememberSelection();
  };

  const setDirection = (direction: "ltr" | "rtl") => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const blockSelector = "p, div, h1, h2, h3, blockquote, li";

    if (range && !range.collapsed) {
      const selectedBlocks = Array.from(
        editor.querySelectorAll<HTMLElement>(blockSelector),
      ).filter((block) => {
        try {
          return range.intersectsNode(block);
        } catch {
          return false;
        }
      });

      if (selectedBlocks.length > 0) {
        selectedBlocks.forEach((block) => block.setAttribute("dir", direction));
      } else {
        editor.setAttribute("dir", direction);
      }
    } else {
      const node = selection?.anchorNode;
      const element = node instanceof Element ? node : node?.parentElement;
      const block = element?.closest(blockSelector) as HTMLElement | null;
      (block && editor.contains(block) ? block : editor).setAttribute(
        "dir",
        direction,
      );
    }

    emitChange();
    rememberSelection();
  };

  const restoreHistory = (nextIndex: number) => {
    const editor = editorRef.current;
    const html = historyRef.current[nextIndex];
    if (!editor || html === undefined) return;
    historyIndexRef.current = nextIndex;
    setSelectedImage(null);
    editor.innerHTML = html;
    const nextValue = `${RICH_TEXT_MARKER}${html}`;
    lastEmittedValueRef.current = nextValue;
    onChange(nextValue);
    editor.focus();
  };

  const undo = () => {
    if (historyIndexRef.current > 0) {
      restoreHistory(historyIndexRef.current - 1);
    }
  };

  const redo = () => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      restoreHistory(historyIndexRef.current + 1);
    }
  };

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") {
      return;
    }
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  };

  const addLink = () => {
    const url = window.prompt(t("linkUrlPrompt"), "https://");
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast({ variant: "destructive", title: t("error"), description: t("invalidLink") });
      return;
    }
    command("createLink", url);
  };

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setIsUploadingImage(true);
    onUploadingChange?.(true);
    try {
      const request = await fetch("/api/storage/uploads/request-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type,
          purpose: "compiled-draft-image",
          compilationId,
        }),
      });
      if (!request.ok) throw new Error("Upload URL failed");
      const { uploadURL, objectPath } = await request.json() as {
        uploadURL: string;
        objectPath: string;
      };
      const upload = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("Upload failed");
      command("insertImage", `/api/storage${objectPath}`);
    } catch {
      toast({ variant: "destructive", title: t("error"), description: t("editorImageFailed") });
    } finally {
      setIsUploadingImage(false);
      onUploadingChange?.(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
    }
  };

  const handlePaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length === 0) return;
    event.preventDefault();
    rememberSelection();
    void (async () => {
      for (const imageFile of imageFiles) {
        await uploadImage(imageFile);
      }
    })();
  };

  const selectImage = (image: HTMLImageElement | null) => {
    if (image) {
      const currentWidth = Number.parseInt(image.style.width, 10);
      setCustomImageWidth(Number.isFinite(currentWidth) ? currentWidth : 100);
    }
    setSelectedImage(image);
  };

  const resizeSelectedImage = (width: string) => {
    if (!selectedImage || !editorRef.current?.contains(selectedImage)) return;
    selectedImage.style.width = width;
    selectedImage.style.maxWidth = "100%";
    selectedImage.style.height = "auto";
    if (!selectedImage.style.marginLeft && !selectedImage.style.marginRight) {
      selectedImage.style.margin = "5px";
    }
    const numericWidth = Number.parseInt(width, 10);
    if (Number.isFinite(numericWidth)) setCustomImageWidth(numericWidth);
    emitChange();
  };

  const alignSelectedImage = (alignment: "left" | "center" | "right") => {
    if (!selectedImage || !editorRef.current?.contains(selectedImage)) return;
    selectedImage.style.float = alignment === "center" ? "none" : alignment;
    selectedImage.style.display = "block";
    selectedImage.style.margin = alignment === "center" ? "5px auto" : "5px";
    emitChange();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b bg-muted/40 p-2" data-testid="rich-text-toolbar">
        <Select onValueChange={(font) => command("fontName", font)}>
          <SelectTrigger className="h-11 w-32 shrink-0 bg-background text-xs sm:h-8" aria-label={t("fontFamily")}>
            <SelectValue placeholder={t("fontFamily")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DM Sans">DM Sans</SelectItem>
            <SelectItem value="Playfair Display">Playfair</SelectItem>
            <SelectItem value="Arial">Arial</SelectItem>
            <SelectItem value="Georgia">Georgia</SelectItem>
            <SelectItem value="Tahoma">Tahoma</SelectItem>
          </SelectContent>
        </Select>
        <Select onValueChange={(size) => command("fontSize", size)}>
          <SelectTrigger className="h-11 w-24 shrink-0 bg-background text-xs sm:h-8" aria-label={t("fontSize")}>
            <SelectValue placeholder={t("fontSize")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2">{t("small")}</SelectItem>
            <SelectItem value="3">{t("normal")}</SelectItem>
            <SelectItem value="4">{t("large")}</SelectItem>
            <SelectItem value="5">{t("extraLarge")}</SelectItem>
          </SelectContent>
        </Select>

        <ToolbarButton label={t("paragraph")} onClick={() => command("formatBlock", "p")}><Pilcrow className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("heading1")} onClick={() => command("formatBlock", "h1")}><Heading1 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("heading2")} onClick={() => command("formatBlock", "h2")}><Heading2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("bold")} onClick={() => command("bold")}><Bold className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("italic")} onClick={() => command("italic")}><Italic className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("underline")} onClick={() => command("underline")}><Underline className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("strikethrough")} onClick={() => command("strikeThrough")}><Strikethrough className="h-4 w-4" /></ToolbarButton>

        <label className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent sm:h-8 sm:w-8" title={t("textColor")}>
          <span className="relative text-sm font-bold">A<span className="absolute -bottom-1 start-0 h-1 w-full bg-gradient-to-r from-red-500 via-green-500 to-blue-500" /></span>
          <input
            type="color"
            className="sr-only"
            aria-label={t("textColor")}
            onChange={(event) => command("foreColor", event.target.value)}
          />
        </label>

        <ToolbarButton label={t("alignLeft")} onClick={() => command("justifyLeft")}><AlignLeft className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("alignCenter")} onClick={() => command("justifyCenter")}><AlignCenter className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("alignRight")} onClick={() => command("justifyRight")}><AlignRight className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("leftToRight")} onClick={() => setDirection("ltr")}><span className="text-xs font-bold">LTR</span></ToolbarButton>
        <ToolbarButton label={t("rightToLeft")} onClick={() => setDirection("rtl")}><span className="text-xs font-bold">RTL</span></ToolbarButton>
        <ToolbarButton label={t("bulletList")} onClick={() => command("insertUnorderedList")}><List className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("numberedList")} onClick={() => command("insertOrderedList")}><ListOrdered className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("quote")} onClick={() => command("formatBlock", "blockquote")}><Quote className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("addLink")} onClick={addLink}><Link className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("removeLink")} onClick={() => command("unlink")}><Unlink className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("addImage")} onClick={() => imageInputRef.current?.click()}><ImagePlus className={`h-4 w-4 ${isUploadingImage ? "animate-pulse" : ""}`} /></ToolbarButton>
        <ToolbarButton label={t("clearFormatting")} onClick={() => command("removeFormat")}><RemoveFormatting className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("undo")} onClick={undo}><Undo2 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton label={t("redo")} onClick={redo}><Redo2 className="h-4 w-4" /></ToolbarButton>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(event) => event.target.files?.[0] && uploadImage(event.target.files[0])}
        />
      </div>
      {selectedImage && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/20 px-2 py-1.5" data-testid="image-edit-toolbar">
          <span className="px-1 text-xs font-medium text-muted-foreground">{t("imageSize")}</span>
          <Select onValueChange={resizeSelectedImage}>
            <SelectTrigger className="h-8 w-24 bg-background text-xs" aria-label={t("imageSize")}>
              <SelectValue placeholder={t("imageSize")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="25%">25%</SelectItem>
              <SelectItem value="50%">50%</SelectItem>
              <SelectItem value="75%">75%</SelectItem>
              <SelectItem value="100%">100%</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{t("customImageWidth")}</span>
            <input
              type="number"
              min={5}
              max={100}
              value={customImageWidth}
              onChange={(event) => setCustomImageWidth(Math.min(100, Math.max(5, Number(event.target.value))))}
              className="h-8 w-16 rounded-md border bg-background px-2 text-foreground"
              aria-label={t("customImageWidth")}
            />
            <span>%</span>
          </label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => resizeSelectedImage(`${customImageWidth}%`)}
          >
            {t("applyImageSize")}
          </Button>
          <ToolbarButton label={t("alignImageLeft")} onClick={() => alignSelectedImage("left")}><AlignLeft className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label={t("alignImageCenter")} onClick={() => alignSelectedImage("center")}><AlignCenter className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton label={t("alignImageRight")} onClick={() => alignSelectedImage("right")}><AlignRight className="h-4 w-4" /></ToolbarButton>
        </div>
      )}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className="rich-text-content min-h-[380px] flex-1 overflow-auto bg-background p-5 outline-none sm:p-7"
        onInput={emitChange}
        onPaste={handlePaste}
        onKeyDown={handleEditorKeyDown}
        onKeyUp={rememberSelection}
        onMouseUp={rememberSelection}
        onFocus={rememberSelection}
        onClick={(event) => {
          const target = event.target;
          selectImage(target instanceof HTMLImageElement ? target : null);
        }}
        data-testid="rich-text-editor"
      />
    </div>
  );
}