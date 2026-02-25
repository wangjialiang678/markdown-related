# Technical plan

## Goal

Create a Markdown viewer with one reusable core module and lightweight platform adapters.

## Architecture

- Core module (`Rust`):
  - Read Markdown files.
  - Convert Markdown to HTML (GFM features enabled).
  - Sanitize output HTML.
  - Generate heading anchors + TOC metadata.
- Shared UI (`Web/H5`):
  - Render HTML output.
  - TOC navigation.
  - Handle local markdown links and images.
- Platform adapters:
  - macOS first (Tauri desktop).
  - Windows next (same desktop stack).
  - Android/iOS later (Tauri mobile shell + same web UI).

## Why H5 + Tauri

- One UI codebase across desktop and mobile.
- One core logic module shared via Rust commands.
- Minimal native surface area.
- File association support on desktop bundles.

## Delivery phases

1. macOS MVP (implemented)
- Open local `.md` files.
- Finder double-click to open bundled app.
- Single-window behavior for second open action.
- TOC and markdown rendering.

2. Windows adapter (planned)
- Package as MSI/NSIS.
- Register markdown file association.
- Validate file-open arguments and single-instance behavior.

3. Android adapter (planned)
- Initialize Tauri Android target.
- Support file-picker/share-open markdown flow.
- Optimize viewport and touch interactions.

4. iOS adapter (planned)
- Initialize Tauri iOS target.
- Add document/share opening flow for markdown files.
- Validate app sandbox file access patterns.

## Notes

- Mobile “default app for .md” behavior depends on OS-level policies and user settings.
- No native UI rewrite is required; only adapter-level setup is needed per platform.
