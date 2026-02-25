import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type RenderedMarkdown = {
  path: string;
  file_name: string;
  base_dir: string;
  html: string;
};

type OpenFilePayload = {
  path: string;
};

const markdownHostEl = document.querySelector<HTMLElement>("#markdown-host");
const emptyStateEl = document.querySelector<HTMLElement>("#empty-state");

function isAndroidRuntime(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function normalizePathFromFileUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") {
      return null;
    }

    const decoded = decodeURIComponent(url.pathname);
    if (/^\/[a-zA-Z]:\//.test(decoded)) {
      return decoded.slice(1);
    }
    return decoded;
  } catch {
    return null;
  }
}

function normalizeDroppedPath(path: string): string | null {
  if (path.startsWith("file://")) {
    return normalizePathFromFileUrl(path);
  }
  return path;
}

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdown|mkd)$/i.test(path);
}

function resolveLocalPath(baseDir: string, rawTarget: string): string | null {
  if (!rawTarget || rawTarget.startsWith("#")) {
    return null;
  }

  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(rawTarget) && !rawTarget.startsWith("file://")) {
    return null;
  }

  if (rawTarget.startsWith("file://")) {
    return normalizePathFromFileUrl(rawTarget);
  }

  if (/^[a-zA-Z]:[\\/]/.test(rawTarget) || rawTarget.startsWith("/")) {
    return rawTarget;
  }

  try {
    const basePrefix = baseDir.endsWith("/") ? baseDir : `${baseDir}/`;
    const resolved = new URL(rawTarget, `file://${basePrefix}`);
    return normalizePathFromFileUrl(resolved.toString());
  } catch {
    return null;
  }
}

function showMessage(message: string) {
  if (emptyStateEl) {
    emptyStateEl.textContent = message;
    emptyStateEl.classList.remove("hidden");
  }
  if (markdownHostEl) {
    markdownHostEl.classList.add("hidden");
  }
}

function rewriteLocalLinksAndImages(container: HTMLElement, baseDir: string) {
  const images = container.querySelectorAll<HTMLImageElement>("img[src]");
  images.forEach((image) => {
    const rawSrc = image.getAttribute("src") || "";
    if (!rawSrc || rawSrc.startsWith("data:") || rawSrc.startsWith("http")) {
      return;
    }

    const localPath = resolveLocalPath(baseDir, rawSrc);
    if (localPath) {
      image.src = convertFileSrc(localPath);
    }
  });

  const links = container.querySelectorAll<HTMLAnchorElement>("a[href]");
  links.forEach((link) => {
    const href = link.getAttribute("href") || "";

    if (href.startsWith("http://") || href.startsWith("https://")) {
      link.target = "_blank";
      link.rel = "noreferrer";
      return;
    }

    const localPath = resolveLocalPath(baseDir, href);
    if (!localPath) {
      return;
    }

    if (isMarkdownPath(localPath)) {
      link.dataset.markdownPath = localPath;
      link.href = "#";
      return;
    }

    link.href = convertFileSrc(localPath);
    link.target = "_blank";
    link.rel = "noreferrer";
  });
}

function renderDocument(doc: RenderedMarkdown) {
  if (!markdownHostEl) {
    return;
  }

  const article = document.createElement("article");
  article.className = "markdown-body";
  article.innerHTML = doc.html;
  rewriteLocalLinksAndImages(article, doc.base_dir);

  markdownHostEl.innerHTML = "";
  markdownHostEl.appendChild(article);
  markdownHostEl.classList.remove("hidden");

  if (emptyStateEl) {
    emptyStateEl.classList.add("hidden");
  }

  document.title = `${doc.file_name} - Markdown Related`;
}

async function openMarkdown(path: string) {
  if (!path) {
    return;
  }

  try {
    const doc = await invoke<RenderedMarkdown>("open_markdown", { path });
    renderDocument(doc);
  } catch (error) {
    showMessage(`Open failed: ${String(error)}`);
  }
}

async function consumeExternalLaunchPath(): Promise<string | null> {
  try {
    return await invoke<string | null>("consume_external_launch_path");
  } catch {
    return null;
  }
}

async function pollExternalLaunchPath() {
  const path = await consumeExternalLaunchPath();
  if (path) {
    await openMarkdown(path);
  }
}

function attachMarkdownLinkListener() {
  markdownHostEl?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const anchor = target.closest("a[data-markdown-path]") as HTMLAnchorElement | null;
    if (!anchor) {
      return;
    }

    const path = anchor.dataset.markdownPath;
    if (!path) {
      return;
    }

    event.preventDefault();
    void openMarkdown(path);
  });
}

async function boot() {
  attachMarkdownLinkListener();

  await getCurrentWindow().onDragDropEvent((event) => {
    if (event.payload.type !== "drop") {
      return;
    }

    const markdownPath = event.payload.paths
      .map((path) => normalizeDroppedPath(path))
      .find((path): path is string => typeof path === "string" && isMarkdownPath(path));

    if (markdownPath) {
      void openMarkdown(markdownPath);
    }
  });

  await listen<OpenFilePayload>("open-file-requested", (event) => {
    void openMarkdown(event.payload.path);
  });

  const launchPath = await invoke<string | null>("get_launch_path");
  if (launchPath) {
    await openMarkdown(launchPath);
  } else {
    showMessage("Open a .md file to view it.");
  }

  if (isAndroidRuntime()) {
    void pollExternalLaunchPath();
    window.setInterval(() => {
      void pollExternalLaunchPath();
    }, 1200);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        void pollExternalLaunchPath();
      }
    });
  }
}

void boot();
