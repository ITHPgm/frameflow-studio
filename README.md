# FrameFlow Studio

**FrameFlow Studio** is an original browser-based video editing starter that brings together two complementary product ideas:

- The fast, creator-friendly editing approach associated with CapCut: import media, arrange shots, trim, split, add text, choose social aspect ratios and preview.
- The AI-directed production workflow associated with InVideo: start with a brief, structure a storyboard, and keep AI-assisted changes editable on a real timeline.

This is an independent project. It does not copy CapCut or InVideo source code, branding, private APIs, templates, or protected assets.

## What is implemented

- Responsive desktop-first editing workspace.
- Local media import for video, image and audio files.
- IndexedDB storage for imported media and the current project on the same browser profile.
- Sequential video/image timeline with clip selection, trim in/out points, duplication, deletion and splitting at the playhead.
- Playhead, playback preview, timeline zoom and 16:9, 9:16, 1:1 and 4:5 canvas presets.
- Editable text overlays with start and end times.
- Local storyboard outline draft from a user brief. This is a deterministic demo, not a connected AI model.
- Undo/redo, autosave and project edit-data JSON export.
- Browser-based silent WebM export using Canvas capture and MediaRecorder (supported browsers only).

## Run locally

No build step or package installation is required for this starter. Use a local HTTP server because the application uses JavaScript modules and IndexedDB.

### Windows PowerShell

```powershell
cd frameflow-studio
py -m http.server 4173
```

### macOS / Linux

```bash
cd frameflow-studio
python3 -m http.server 4173
```

Open `http://localhost:4173` in a recent version of Chrome or Edge.

## First edit

1. Select **Import media** and choose one or more video or image files.
2. Click an asset or drag it onto the Video lane.
3. Select a clip on the timeline. Set its source in/out points in the Inspector.
4. Move the playhead and use **Split** to cut a clip into two editable segments.
5. Add a text layer and adjust its wording and timing in the Inspector.
6. Select **Export video** to render a silent `.webm` preview.

Audio files can be imported and kept in the media library, but audio-track arrangement, mixing, voiceover generation and sound export are not implemented in this starter.

## Important limitations

This is a functional proof of concept, not a production-grade replacement for CapCut or InVideo. It currently does not include:

- AI-generated video or image assets, LLM script writing, automatic media selection or natural-language editing of an existing timeline.
- Audio tracks, music mixing, voiceover, TTS, noise removal, waveform editing or audio export.
- MP4/H.264 export, FFmpeg rendering, 4K/60 fps output or professional color grading.
- Advanced transitions, keyframe animation, motion tracking, chroma key, stabilization or speed ramps.
- Cloud projects, accounts, team collaboration, live cursors, comments, version branches or server-side rendering.
- A complete phone/tablet editing experience.

The WebM export is intentionally silent and is labelled as such in the app. Original imported media remains in browser storage and is not uploaded to a server. Clearing browser site data can remove local media and project state, so keep source files and use the project JSON export as an edit-data backup. The project JSON does not embed media files.

## Architecture

- `index.html` — application shell and editor workspace.
- `src/styles.css` — responsive dark editor UI.
- `src/app.js` — project state, browser persistence, media import, timeline, preview and WebM export.
- `docs/PRODUCT_BLUEPRINT.md` — proposed full product architecture and feature roadmap.
- `docs/REA_ANALYSIS_WORKFLOW.md` — how to use the supplied REA toolkit in a local, authorized analysis workflow.

## Suggested production stack

For a serious multi-user editor, keep the browser editor and rendering services separate:

- **Frontend:** React + TypeScript, WebCodecs where supported, Canvas/WebGL preview and a robust timeline state model.
- **Media processing:** FFmpeg or FFmpeg.wasm for proxy generation, trimming, compositing and final encoding; server-side workers for long/high-resolution jobs.
- **Backend:** Node.js API, PostgreSQL for projects/users, object storage for media, Redis/queue workers for renders.
- **AI orchestration:** provider-neutral adapters for script planning, shot lists, transcription, captioning, TTS, image/video generation and timeline-edit commands.
- **Realtime:** WebSocket collaboration, optimistic operations, snapshots and version history.

See the product blueprint before adding production dependencies.

## License

The FrameFlow Studio starter files are provided under the MIT License. See `LICENSE`.
