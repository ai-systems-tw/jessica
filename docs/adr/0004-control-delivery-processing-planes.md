# ADR-0004: Separate control, delivery, and processing planes

Status: Accepted

- Supabase Postgres: control plane
- Cloudflare Pages/Workers/R2: delivery plane
- local/container worker: geometry processing plane

Heavy OpenCV/Blender work is not placed in Cloudflare Workers.
