# Upstream copies

Studio's frontend is a deliberate fork, so the original interface in `web/` stays unchanged. These files were copied from `web/src/` at commit `8a1ef88` (v0.4.0), then changed here as Studio needs:

- `audio.ts`, `pianoroll.ts`, `export.ts`, `sse.ts`, `instruments.ts`, `progress.ts`, `style.css`, `vite-env.d.ts`
- `components/PianoRollCanvas.tsx`
- `hooks/useAudioEngine.ts`

The backend also imports these private helpers from `muscriptor.utils.sheets`: `_fail`, `_run` and `_write_part_pdfs`. Check them after updating upstream.

To see what Studio changed in a copied file:

```
git diff 8a1ef88:web/src/audio.ts HEAD:studio/web/src/audio.ts
```
