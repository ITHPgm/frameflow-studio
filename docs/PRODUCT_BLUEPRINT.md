# FrameFlow Studio — Product Blueprint

## Product definition

FrameFlow is one editor with two equally important workflows:

1. **Edit manually:** import footage and build a multitrack sequence with direct control over cuts, layers, titles, sound and color.
2. **Direct with an assistant:** describe an outcome or an edit in natural language. The assistant turns the request into an explainable sequence of timeline operations that the user can inspect, change, undo and approve.

The assistant must never create a separate, flattened video that cannot be edited. Its output should be normal project objects: media references, clip segments, text layers, audio clips, effects and keyframes.

## Product pillars

### A. Creator-first editing

- Drag-and-drop media bin with thumbnails, search, folders and proxies.
- Multitrack timeline: video, image, overlay, title, caption, music, effects and voice tracks.
- Frame-accurate trim, split, ripple delete, slip/slide, snapping, markers and grouped clips.
- Crop, transform, opacity, blend modes, speed curves and keyframe animation.
- Social presets: 16:9, 9:16, 1:1, 4:5 and custom dimensions.
- Effects, transitions, filters, LUTs, chroma key and background removal.
- Subtitle styling, caption templates, transcript-based edits and translation.

### B. AI production assistant

- Prompt-to-brief: objective, audience, platform, tone, length and call to action.
- Script writer with editable scenes and narration.
- Storyboard: one scene card per shot, with visual intent, timing, narration and asset requirements.
- Media matching: recommend a clip from the user's bin or licensed stock library; never silently use unlicensed assets.
- Generation adapters for images, video, music and voice. Display provider, model, cost estimate, generation status and rights/usage notes.
- Timeline commands: “remove the silence,” “make this 30 seconds,” “create a vertical version,” “add captions,” “lower music under speech,” or “match the color of shots 2 and 3.”
- Preview a proposed change list before it is applied. Every operation is reversible and recorded in history.
- Project memory stores the user's approved creative decisions, not hidden provider state.

### C. Production and collaboration

- Export presets per platform, resolution, frame rate, codec, bitrate and audio loudness.
- Background render queue with progress, retry and cancel.
- Project snapshots, named versions, restore and compare.
- Share links with view/comment/edit permissions, frame-accurate comments and presence.
- Team libraries, reusable brand kits, fonts, colors, lower thirds and intro/outro presets.

## Recommended system architecture

```text
Web / Desktop UI
  ├── Media Library
  ├── Timeline & Preview Engine
  ├── Inspector & Effects
  ├── AI Director Panel
  └── Collaboration Client
          │
          ▼
Application API (Node.js + TypeScript)
  ├── Auth & Workspaces
  ├── Project / Timeline Service
  ├── Media Ingest & Proxy Service
  ├── AI Orchestrator
  ├── License / Usage Registry
  ├── Collaboration Gateway
  └── Export Job API
          │
          ├── PostgreSQL — projects, users, timeline operations, versions
          ├── Object Storage — uploaded and generated media, proxies, renders
          ├── Redis / Queue — render and AI jobs
          ├── AI Providers — LLM, transcription, TTS, image/video/music models
          └── Render Workers — FFmpeg, WebCodecs-compatible pipelines
```

### Core domain model

- `Project`: id, workspaceId, title, aspectRatio, frameRate, resolution, duration, versionId.
- `MediaAsset`: id, projectId, storageKey, kind, mimeType, duration, dimensions, fps, audioChannels, checksum, rightsMetadata.
- `Track`: id, projectId, kind, order, muted, locked, visible, gain.
- `Clip`: id, trackId, assetId, timelineStart, sourceIn, sourceOut, playbackRate, transform, effects, keyframes.
- `TextLayer`: id, trackId, text, style, timelineStart, timelineEnd, keyframes.
- `AudioMix`: id, trackId, assetId, timelineStart, sourceIn, sourceOut, gain, fadeIn, fadeOut, ducking.
- `AIJob`: id, projectId, provider, model, task, input, status, outputAssetIds, costEstimate, createdAt.
- `TimelineOperation`: id, projectId, actorId, operationType, payload, inversePayload, createdAt.
- `ProjectVersion`: id, projectId, label, snapshot, createdAt.

### Timeline rules

Store media source time and timeline time separately. A clip's project position must not be inferred from its array index. Tracks can overlap; clip positions are explicit. Keep source in/out points, playback rate, transforms, effects and keyframes as editable properties. Use an operation log with inverse operations for reliable undo/redo and collaboration.

## AI editing contract

The model should return a validated edit plan, not executable code. Example:

```json
{
  "summary": "Shorten the opening and add captions",
  "operations": [
    { "type": "trim_clip", "clipId": "clip_01", "sourceIn": 1.2, "sourceOut": 7.8 },
    { "type": "add_caption_track", "language": "en" },
    { "type": "insert_caption", "start": 0.4, "end": 2.1, "text": "A better way to get started" }
  ],
  "requiresUserApproval": true
}
```

Validate all IDs, time ranges, track constraints, asset permissions and project bounds on the server before applying. Reject unknown operation types. Show a human-readable diff and provide undo.

## Delivery roadmap

### Phase 1 — Editor foundation

- Replace the starter's sequential timeline with explicit multitrack tracks and clip positions.
- Build waveform/proxy generation, robust preview, audio playback/mixing and project serialization.
- Add FFmpeg-based export for MP4/H.264 and WebM with audio, progress, cancellation and safe resource limits.
- Add automated tests for timeline arithmetic, trimming, splitting, overlapping tracks and render boundaries.

### Phase 2 — Creative toolkit

- Captions/transcription, title presets, transitions, transform, filters, keyframes and color controls.
- Export presets for YouTube, TikTok, Instagram, Facebook and generic masters.
- Local project library, autosave, recovery and asset relinking.

### Phase 3 — AI director

- LLM provider abstraction and script/storyboard generation.
- Transcription and transcript-based editing.
- Text-to-speech, voiceover, image/video/music generation adapters.
- Prompt-to-timeline operations with confirmation, audit trail and undo.

### Phase 4 — Cloud and collaboration

- Authentication, workspaces, cloud storage, resumable uploads and render queue.
- Team permissions, comments, cursors, operation synchronization and snapshots.
- Billing, quotas, provider cost accounting and content licensing records.

## Non-goals and legal guardrails

- Do not use CapCut or InVideo names, logos, source code, private endpoints, proprietary templates or UI assets as product assets.
- Do not bypass app protections, authentication, DRM, payment controls or access restrictions.
- Use documented APIs or user-authorized local analysis. Use licensed media, fonts, music and model outputs.
- Build an original layout and implementation from observed public/user-visible workflows and independently authored code.
