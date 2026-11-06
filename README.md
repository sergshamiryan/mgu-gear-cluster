# Gear on Cluster — MGU Store source (OTA, no SSH)

Shows the engaged gear (**D1 … D8**, and **R / N / P**) on the **instrument
cluster** of a BMW G20 (iDrive 7 / MGU). This folder is a **Store source**: you
add it in the car and the head unit builds and installs the app over the air.
No PC build, no SSH.

> The manual SSH build is still available as a fallback in
> `C:\Users\Admin\mgu-gear-cluster\` — use it only if the OTA path doesn't work.

---

## Which layout this is, and why

The MGU Store reads a source in one of three layouts (store `docs/PUBLISHING.md`).
Our app is a **cmg-kit app** (`app.json` + `main.js` using the kit's `Car` /
`Canvas` runtime), exactly like the store's performance apps (Redline, M Vitals).
Those are published to the store as a **repo tree with an on-unit build script**
— the `cauliflowermossgrape/idrive7-apps` repo does this with
`kit/tools/build.py`. We mirror that pattern:

- **`mgu-repo.json`** at the root declares one `apps/*` entry whose `build`
  runs **`kit/tools/build.py {id}`** on the head unit, with the BMW `oap-sdk`
  generated on-car from a donor app (`"sdk": "oap-sdk"`), output
  `dist/{id}@{version}.tgz`.
- The `shared` list names the exact kit files the on-unit build needs — copied
  verbatim from the cmg source's own working manifest (`kit/runtime`,
  `kit/platform`, `kit/localization`, `kit/tools/build.py`, `pack_data.py`,
  `localize.py`, `locale-revisions.json`, `make_icon.js`, `oapgen`, and the
  generated `oap-sdk`).

**Why this layout:** it's the one BMW's SDK rule forces (no SDK in the repo — the
car links it from its own donor) and the one the store already uses for exactly
this kind of app. A "Releases"/"Catalog" layout would need us to ship a pre-built
package, which can't legally contain the SDK and would need a PC build anyway.

**No SDK is in this repo.** The head unit generates `oap-sdk` from a stock BMW
app already on your car at build time. Nothing copyrighted is published.

---

## File tree

```
mgu-gear-cluster-store/
├── mgu-repo.json                      # root manifest: apps/* + on-unit build
├── README.md
├── apps/
│   └── gear_cluster/
│       ├── app.json                   # manifest: gear signal block, screen, settings
│       ├── main.js                    # reads gear, draws it on the cluster via cluster-render
│       ├── cluster_render_client.js   # bundled cluster-render client (MPL-2.0)
│       └── icon.png                   # 140×140 store/app icon
└── kit/                               # the cmg build + runtime the car needs (no SDK)
    ├── runtime/                       # Car, Canvas, mgu, signals, fonts, …
    ├── platform/permissions.json
    ├── localization/fonts/
    ├── tools/{build.py,pack_data.py,localize.py,locale-revisions.json,make_icon.js,oapgen/}
    └── LICENSE                        # cmg idrive7-apps (MIT)
```

Repo size ≈ 3 MB (the car downloads it once, then builds).

---

## App id and head unit

- **`mguHmi: ["ID7"]`** (set in `mgu-repo.json`) — iDrive 7 only, which is your car.
- **App id `gear_cluster`.** The store recommends a personal prefix, but it is
  not required: for a repo-tree build the store takes the id from the build
  args, and if that id ever clashed with another source it installs ours beside
  it as `gear_cluster2`. If you prefer, rename the `apps/gear_cluster/` folder
  (e.g. `sergey_gear`) before committing — the folder name becomes the id.

---

## Renderer requirement (important)

The app draws on the cluster through the **`cluster-render`** tool — the one you
already installed when you set up **Waze-on-cluster** (`waze-on-cluster` lists
`"requires": { "cluster-render": "0.4.0" }`). `cluster-render`'s own
`component.json` does **not** advertise a generic `renderer` capability, so this
app does **not** hard-require it (that would risk the store trying to reinstall
it). Instead it **relies on it already being present**, which it is on your car.

- If `cluster-render` is somehow missing, the app still installs and runs; its
  status page just says *"Connecting to the cluster service…"*. Fix: make sure
  Waze-on-cluster (and thus `cluster-render`) is installed.
- The app's own small **centre-screen status page** uses the normal RHMI image
  path and falls back to PNG if the cmg GPU renderer isn't installed — so it
  needs **no** extra renderer. (If you also add the
  `cauliflowermossgrape/idrive7-apps` source, its `idrive7-renderd` +
  `mgu-inputgate` give the centre page 60 fps and rotary-knob button control; on
  the G20 the **touchscreen** works for the buttons regardless.)

---

## Install A — GitHub source (OTA)

1. **Create a GitHub repo** (public is simplest; private works too, the car uses
   a token) — e.g. `sergshamiryan/mgu-gear-cluster`.
2. **Commit the entire contents of this folder** to the repo root (so
   `mgu-repo.json` is at the repo root). Do **not** add any `oap-sdk/` or
   `node_modules/` — none is here, keep it that way.
3. On the head unit: open the **Store** tile → **Settings / Sources** → **Add
   source** → enter **`sergshamiryan/mgu-gear-cluster`** (owner/repo), or paste
   the GitHub URL. For a private repo, give the token when asked.
4. Pick the **channel**: choose the repo's **branch** (e.g. `main`) so the store
   follows it — each push becomes a new revision. (A `vX.Y.Z` tag → "Tags"
   channel also works.)
5. Back in the Store list, **Gear on Cluster** appears. Install it. The head unit
   **builds it from source** (Python on the unit, ~1–2 min the first time) and
   installs it.
6. Open the **Gear on Cluster** tile, confirm the status line says *"Showing on
   the cluster"*, put the car in **D**, and drive. Tune size/position/colour in
   the tile's **Settings**.

To update later: push to the branch → the store shows a new revision → Update.

---

## Install B — USB stick (no car internet)

Your car doesn't need internet for this. Two ways:

**B1. Pre-pack with the store installer (recommended):** on a PC with Node,
using the store repo (`robertnisipeanu/mgu-store`):

```powershell
node deploy\mgu-install.js usb-repo <StickDrive>:\ github:sergshamiryan/mgu-gear-cluster
```

This copies the published source onto the stick (as the store expects). Then in
the car: **Store → Add source → USB**, pick the stick, install **Gear on
Cluster**. The unit builds it from the stick.

**B2. Plain copy:** a plain checkout of this folder copied to the stick works the
same way (store `docs/PUBLISHING.md`, "A plain checkout copied to a USB stick
works the same way"). Copy this whole folder so **`mgu-repo.json` sits at the
stick root** (or inside `mgu-repo/`), insert it, then **Store → Add source →
USB** and install. No revision tracking, but it builds and installs identically.

> Either USB method still builds **on the car** and links the SDK from your
> car's own donor — nothing copyrighted is on the stick.

---

## The one thing I could not verify without the car

**That the head unit will build a custom source app end-to-end on your exact
firmware.** The mechanism is the store's documented repo-tree build and is how
the store's own performance apps are delivered, so it should "just work" — but I
can't prove it on your unit. The two concrete unknowns:

1. **On-unit build:** needs the store's Python build support on the car (shipped
   with the updater). If the build step isn't available, the Store will say so;
   then use the SSH fallback in `C:\Users\Admin\mgu-gear-cluster\`.
2. **Cluster socket access & slot arbitration** — same as the SSH version:
   whether the app's sandbox can open `/dev/shm/cluster-render/render.sock` and
   whether the cluster grants the slot while driving. The in-app **"Where on the
   cluster"**, **"Show over the stock cluster"** and **"Show now"** settings are
   there to tune this.

Everything else (gear reading, drawing, the app format, the build manifest) is
matched to the real, working store/SDK source — not guessed.

---

## Licences

- App code (`app.json`, `main.js`) and this packaging: custom.
- `apps/gear_cluster/cluster_render_client.js`: **MPL-2.0**, © Robert Nisipeanu,
  from `robertnisipeanu/idrive-apps` (header kept).
- `kit/`: from `cauliflowermossgrape/idrive7-apps` (**MIT**, see `kit/LICENSE`).
