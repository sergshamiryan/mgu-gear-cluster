'use strict';
/**
 * Gear on Cluster
 * ---------------
 * Shows the engaged gear (D1..D8, plus R / N / P) on the BMW instrument
 * cluster of an iDrive 7 (MGU) car.
 *
 * How the pieces fit together:
 *   - kit/car.js (the kit's Car class) reads the gear over SOME/IP
 *     (VehicleInformation.statusGearboxDrive / DataPowerTrain2), and falls
 *     back to a learner that works the gear out from rpm vs speed on cars
 *     that don't broadcast the engaged gear.
 *   - cluster_render_client.js (bundled, from the cluster-render project)
 *     opens /dev/shm/cluster-render/render.sock and puts an RGBA *image*
 *     layer on the cluster. This is the exact same service Waze-on-cluster
 *     uses, so it must already be installed (it is, once Waze-on-cluster is).
 *   - kit/canvas.js draws the gear text into a raw RGBA buffer that we hand
 *     straight to the render socket.
 *
 * The app's own tile (centre screen) is only a small status / preview page;
 * the gear itself is drawn on the cluster, not on the centre screen.
 */

const mgu = require('./kit/mgu');
const Car = require('./kit/car');
const { Canvas } = require('./kit/canvas');
const { ClusterRender } = require('./cluster_render_client.js');

const MAIN_W = 1280, MAIN_H = 400;        // centre-screen status page

// square badge sizes (px) per the 'size' setting
const SIZE = { small: 120, medium: 170, large: 240 };
// text colours per the 'colour' setting
const COLOUR = { white: '#ffffff', red: '#ff2b3d', amber: '#ffb01a', green: '#2fd27a', blue: '#3aa0ff' };
const GUESS_COLOUR = '#9fb0c0';           // dimmer colour while the gear is only learned, not read

// iDrive 7 cluster 'map' target is 1088 x 480 (from cluster-render ABI notes).
// Positions below are computed for that; other targets still work but the
// presets are tuned for the map area.
const MAP_W = 1088, MAP_H = 480;
const PAD = 28;

mgu.run({
    async start(ctx) {
        const { ui, settings, log } = ctx;

        // read gear (+ rpm/speed for the learner fallback)
        const car = new Car(ctx, ['gear', 'rpm', 'speed']);

        const cr = new ClusterRender('gear_cluster');
        let layer = 0;            // current cluster layer ref (0 = none)
        let curSig = null;        // last drawn signature, to skip redundant redraws
        let shownState = '';      // last 'layer' state from the service (shown/waiting/...)

        /* ---------- geometry ---------- */
        function geom() {
            const w = SIZE[settings.get('size')] || SIZE.medium, h = w;
            const pos = settings.get('position') || 'lower-centre';
            const cx = Math.round((MAP_W - w) / 2);
            let x = cx, y = MAP_H - h - PAD;                         // lower-centre (default)
            if (pos === 'centre') { y = Math.round((MAP_H - h) / 2); }
            else if (pos === 'upper-centre') { y = PAD; }
            else if (pos === 'lower-right') { x = MAP_W - w - PAD; }
            else if (pos === 'lower-left') { x = PAD; }
            return { x, y, w, h };
        }

        /* ---------- (re)create the cluster layer ---------- */
        function buildLayer() {
            if (layer) { try { cr.drop(layer); } catch (e) {} layer = 0; }
            const g = geom();
            const target = settings.get('target') || 'map';
            layer = cr.image({
                target: target, klass: 'overlay', z: 80,
                x: g.x, y: g.y, w: g.w, h: g.h, iw: g.w, ih: g.h,
                contend: settings.get('contend') !== false,          // take the slot from the stock cluster
                visible: settings.get('enabled') !== false,
            });
            if (!layer) { log.warn('cluster layer refused for target ' + target); return; }
            curSig = null;                                            // force the next draw
            draw(true);
        }

        /* ---------- label from the car data ---------- */
        function labelOf(d) {
            const st = d.stage;                                       // 'P'/'R'/'N'/'D' or undefined
            if (st === 'P') return 'P';
            if (st === 'N') return 'N';
            if (st === 'R' || d.gear === -1) return 'R';
            const g = d.gear;
            if (g != null && g >= 1) return settings.get('prefix') === 'num' ? String(g) : 'D' + g;
            if (st === 'D') return 'D';
            return d.demo ? 'D' : '-';                                // nothing known yet
        }

        /* ---------- draw the badge onto the cluster ---------- */
        function draw(force) {
            if (!layer) return;
            const d = car.data();
            const label = labelOf(d);
            const guessed = d.gearGuessed && !d.demo && label !== '-';
            const colour = guessed ? GUESS_COLOUR : (COLOUR[settings.get('colour')] || COLOUR.white);
            const transparent = settings.get('blend') === 'transparent';
            const panel = !!settings.get('panel');
            const sig = label + '|' + colour + '|' + transparent + '|' + panel;
            if (!force && sig === curSig) return;                     // only redraw on a real change
            curSig = sig;

            const g = geom();
            const cv = new Canvas(g.w, g.h);
            // Opaque black tile is invisible on the cluster's black background, so the
            // text looks like it floats. Transparent is available but experimental.
            cv.clear(transparent ? [0, 0, 0, 0] : '#000000');
            if (panel) {
                if (cv.roundRect) cv.roundRect(0, 0, g.w, g.h, Math.round(g.w * 0.16), [20, 24, 30, 220]);
                else cv.fillRect(0, 0, g.w, g.h, [20, 24, 30, 220]);
            }
            const size = Math.round(g.h * (label.length > 2 ? 0.46 : 0.62));
            const baseline = Math.round(g.h / 2 + size * 0.35);
            cv.text(label, Math.round(g.w / 2), baseline, size, colour, { align: 'center', font: 'bold' });

            let buf = Buffer.from(cv.d.buffer, cv.d.byteOffset, cv.d.length);
            if (transparent) buf = premultiply(buf);
            try { cr.pixels(layer, null, buf); } catch (e) { log.warn('pixels: ' + e); }
        }

        // straight alpha -> premultiplied (only used for the transparent background mode)
        function premultiply(src) {
            const out = Buffer.from(src);
            for (let i = 0; i < out.length; i += 4) {
                const a = out[i + 3];
                if (a === 255 || a === 0) continue;
                out[i] = (out[i] * a / 255) | 0;
                out[i + 1] = (out[i + 1] * a / 255) | 0;
                out[i + 2] = (out[i + 2] * a / 255) | 0;
            }
            return out;
        }

        /* ---------- cluster socket lifecycle ---------- */
        cr.on('ready', () => { log.info('cluster-render ready; targets=' + cr.targets); buildLayer(); });
        cr.on('layer', (ref, state, reason) => {
            if (ref !== layer) return;
            shownState = state;
            log.info('layer ' + state + (reason ? ' (' + reason + ')' : ''));
        });
        cr.on('target', (name, state, holder) => log.info('target ' + name + ' ' + state + (holder ? ' held by ' + holder : '')));
        cr.on('refused', (op, ref, reason) => log.warn('refused ' + op + ': ' + reason));
        cr.on('disconnected', () => { shownState = ''; log.info('cluster-render disconnected'); });
        cr.connect();

        // Poll the gear every 200 ms and redraw only when it changes. Polling
        // (rather than relying on rpm ticks) keeps it correct at a standstill
        // and with the engine off, where the car sends few updates.
        setInterval(() => draw(false), 200);

        // Rebuild the layer when size / position / target / visibility change.
        settings.onChange(() => { if (cr.ready) buildLayer(); renderMain().catch(() => {}); });

        /* ---------- centre-screen status page ---------- */
        async function renderMain() {
            const t = ctx.theme();
            const cv = ctx.canvas(MAIN_W, MAIN_H).clear(t.bg);
            const d = car.data();
            const label = labelOf(d);
            const on = settings.get('enabled') !== false;

            // big preview on the left
            cv.text(label, 300, 258, 210, COLOUR[settings.get('colour')] || t.text, { align: 'center', font: 'bold' });

            // status on the right
            const line = !cr.ready ? 'Connecting to the cluster service...'
                : !layer ? 'Cluster refused the layer - try another "Where on the cluster" in Settings'
                : !on ? 'Turned off (Settings > Show gear on cluster)'
                : shownState === 'shown' ? 'Showing on the cluster (' + (settings.get('target') || 'map') + ')'
                : shownState ? 'Cluster: ' + shownState + ' - map/nav may need to be up'
                : 'Waiting for the cluster to grant the slot...';
            const src = d.demo ? 'DEMO data (no car signal yet)'
                : d.gearGuessed ? 'Gear learned from rpm/speed (drive a bit to teach it)'
                : 'Live gear signal from the gearbox';

            cv.text('GEAR ON CLUSTER', 620, 72, 34, t.dim, { font: 'bold', spacing: 2 });
            cv.text(line, 620, 150, 26, t.text);
            cv.text(src, 620, 198, 24, t.dim);
            cv.text(on ? 'Settings: size, position, colour, where on the cluster' : '', 620, 250, 22, t.dim);
            await ui.image('MAIN_GFX', cv);
        }

        // "Show now" re-asserts the layer (handy if the stock cluster took the slot back)
        ui.onClick('BTN_ACTION', () => { if (cr.ready) buildLayer(); return renderMain(); });
        ctx.loop('MAIN', 3, renderMain);
        renderMain().then(() => log.info('gear_cluster started')).catch((e) => log.warn('first render: ' + e));
    },
});
