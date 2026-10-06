"""
luxury_suit_scroll.py
Scroll driven hero sequence for a luxury menswear site.
Builds, animates and renders a mannequin in a navy two piece suit inside a boutique.

Target: Blender 4.2 LTS or newer, Cycles. Only bundled importers are used (FBX, glTF, OBJ).

Run inside Blender (Scripting workspace > Run Script) to build the scene for review,
or headless to build and render both variants:
    blender -b --python luxury_suit_scroll.py -- --final --output /path/to/render
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

# =============================================================================
# CONFIG
# =============================================================================

# User supplied assets. Empty string means "build a clearly named placeholder".
# Assets are expected in meters, Z up, feet at the origin, facing -Y.
MANNEQUIN_PATH = ""          # .fbx .obj .glb .gltf .blend
SUIT_PATH = ""               # .fbx .obj .glb .gltf .blend
# External studio HDRI (.hdr or .exr). This is a real asset dependency.
# When empty, glossy rays see a flat neutral grey instead. No HDRI is faked.
HDRI_PATH = ""
HDRI_STRENGTH = 1.0
HDRI_ROTATION_DEG = 0.0

OUTPUT_DIR = os.path.join(os.path.expanduser("~"), "angelico_render")
SAVE_BLEND_PATH = ""         # optional: save the built scene here (useful for render farms)

PREVIEW_MODE = True          # 25 percent resolution, 32 samples
RENDER_ON_RUN = None         # None: render only when Blender runs headless (-b)
VARIANTS_TO_RENDER = ("desktop", "mobile")

USE_CLOTH_SIM = False        # drape the jacket over the mannequin, then freeze it
CLOTH_SETTLE_FRAMES = 40
CLOTH_OBJECT_KEYWORD = "jacket"   # how the jacket is found inside an imported suit
CLOTH_PIN_HEIGHT = 1.36           # vertices above this Z stay pinned (shoulders, chest)

# Camera path. Speed is linear by construction: every frame is keyed explicitly.
FRAME_COUNT = 180
PUSH_START_FRAME = 120       # frames 1..119 orbit, 120..180 push in on the lapel
ORBIT_DEGREES = 180.0
ORBIT_DIRECTION = 1          # 1 or -1
CAMERA_HEIGHT = 1.35         # chest height in meters
ORBIT_TARGET_Z = 1.0         # vertical center of the mannequin, keeps it centered

# Where the push in lands. None uses the placeholder lapel (exact) or a default estimate
# for imported suits. For an imported suit set both to a point ON the lapel surface and
# the lapel's outward normal, read from your asset.
LAPEL_POINT = None           # e.g. (0.085, -0.140, 1.264)
LAPEL_NORMAL = None          # e.g. (0.34, -0.93, 0.10)

# Fabric scale. Placeholder UVs are authored in meters, so 1.0 is physically correct.
# For imported garments set this to (UV units per meter) of your asset.
WEAVE_UV_SCALE = 1.0
WOOL_YARN_PITCH_M = 0.0003   # about 33 ends per cm, typical of fine worsted suiting

VARIANTS = {
    # orbit_radius frames the full figure. end_distance makes the weave fill the frame.
    # Blender cameras are pinholes: frame width = sensor * distance / lens.
    # Desktop end: 36 mm * 0.075 m / 50 mm = 5.4 cm of lapel across 2560 px.
    "desktop": dict(res=(2560, 1440), lens=50.0, orbit_radius=6.2,
                    end_distance=0.075, fstop_orbit=2.0, fstop_end=11.0),
    # Mobile 9:16. AUTO sensor fit applies the 36 mm sensor to the long (vertical) side.
    "mobile": dict(res=(1080, 1920), lens=50.0, orbit_radius=3.7,
                   end_distance=0.100, fstop_orbit=2.0, fstop_end=11.0),
}

FINAL_SAMPLES = 1024
PREVIEW_SAMPLES = 32
FINAL_NOISE_THRESHOLD = 0.01
PREVIEW_NOISE_THRESHOLD = 0.03
NOISE_SEED = 1618            # fixed seed: no per frame noise crawl when users scrub slowly
PNG_COLOR_DEPTH = "8"        # 8 bit is what WebP/AVIF consume. Use "16" for a master archive.
AGX_LOOKS = ("AgX - Medium High Contrast", "Medium High Contrast", "None")

ROOM_HALF = 9.0              # boutique is 18 x 18 m, so backgrounds sit 11 to 15 m behind focus
ROOM_HEIGHT = 5.5            # tall enough that the 9:16 frame never sees over the walls

RNG_SEED = 7                 # all procedural placement is deterministic

# Farm and cloud options (Colab sessions can drop at any time).
RESUME = False               # skip frames already on disk, so a restarted run continues
FRAME_RANGE = None           # (start, end) to split one variant across machines


# =============================================================================
# SMALL HELPERS
# =============================================================================

def log(msg):
    print(f"[luxury_suit_scroll] {msg}")


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3.0 - 2.0 * x)


def get_collection(name):
    scene = bpy.context.scene
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in scene.collection.children:
        scene.collection.children.link(coll)
    return coll


def move_to_collection(ob, coll):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    coll.objects.link(ob)


def set_material(ob, mat):
    if ob.type != "MESH":
        return
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def mesh_object(name, verts, faces, coll, mat=None, loop_uvs=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if loop_uvs is not None and len(loop_uvs) == len(me.loops):
        uv = me.uv_layers.new(name="UVMap")
        uv.data.foreach_set("uv", [c for pair in loop_uvs for c in pair])
    me.validate()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    if mat:
        set_material(ob, mat)
    return ob


def add_subsurf(ob, levels=2):
    mod = ob.modifiers.new("Subdivision", "SUBSURF")
    mod.levels = 1
    mod.render_levels = levels
    return mod


def add_solidify(ob, thickness):
    mod = ob.modifiers.new("Solidify", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = -1.0
    mod.use_even_offset = True
    return mod


# --- profile driven geometry -------------------------------------------------
# Every placeholder garment and body part is a loft of elliptical rings.
# keys: [(z, rx, ry), ...] sorted by z. Angle a = 0 is the front (-Y), +a turns to +X.

def sample_profile(keys, z):
    if z <= keys[0][0]:
        return keys[0][1], keys[0][2]
    if z >= keys[-1][0]:
        return keys[-1][1], keys[-1][2]
    for k0, k1 in zip(keys, keys[1:]):
        if k0[0] <= z <= k1[0]:
            t = smoothstep((z - k0[0]) / (k1[0] - k0[0]))
            return lerp(k0[1], k1[1], t), lerp(k0[2], k1[2], t)
    return keys[-1][1], keys[-1][2]


def ripple_factor(ripples, a, z):
    """Radial folds. Placeholder stand in for real creasing at elbows, waist and hems."""
    f = 1.0
    for rp in ripples:
        z0, z1 = rp["z"]
        if not z0 < z < z1:
            continue
        env = math.sin(math.pi * (z - z0) / (z1 - z0))
        side = 1.0
        if rp.get("side") is not None:
            side = max(0.0, math.cos(a - rp["side"])) ** 2
        # Phase varies with angle so folds spiral slightly instead of forming perfect rings.
        phase = rp.get("twist", 0.6) * math.sin(3.0 * a + rp.get("seed", 0.0))
        f += rp["amp"] * env * side * math.sin(2.0 * math.pi * (z - z0) / rp["wl"] + phase)
    return f


def surface_point(keys, a, z, off=0.0):
    rx, ry = sample_profile(keys, z)
    return Vector(((rx + off) * math.sin(a), -(ry + off) * math.cos(a), z))


def arc_speed(keys, a, z):
    rx, ry = sample_profile(keys, z)
    return math.hypot(rx * math.cos(a), ry * math.sin(a))


def loft(name, keys, coll, mat=None, segments=48, step=0.01, cap_bottom=False,
         cap_top=False, skip=None, ripples=()):
    """Ring loft with UVs in meters: u = arc length, v = height. Weave scale stays physical."""
    z0, z1 = keys[0][0], keys[-1][0]
    rings = max(2, int(round((z1 - z0) / step)) + 1)
    zs = [lerp(z0, z1, i / (rings - 1)) for i in range(rings)]
    da = 2.0 * math.pi / segments
    angles = [-math.pi + da * j for j in range(segments)]

    verts = []
    for z in zs:
        rx, ry = sample_profile(keys, z)
        for a in angles:
            f = ripple_factor(ripples, a, z)
            verts.append((rx * f * math.sin(a), -ry * f * math.cos(a), z))

    def uv(i, a):
        rx, ry = sample_profile(keys, zs[i])
        return (a * 0.5 * (rx + ry), zs[i])

    faces, uvs = [], []
    S = segments
    for i in range(rings - 1):
        for j in range(segments):
            a0, a1 = angles[j], angles[j] + da
            if skip and skip(0.5 * (a0 + a1), 0.5 * (zs[i] + zs[i + 1])):
                continue
            jn = (j + 1) % S
            faces.append((i * S + j, i * S + jn, (i + 1) * S + jn, (i + 1) * S + j))
            uvs += [uv(i, a0), uv(i, a1), uv(i + 1, a1), uv(i + 1, a0)]

    for ring, top in ((0, False), (rings - 1, True)):
        if (top and not cap_top) or (not top and not cap_bottom):
            continue
        c = len(verts)
        verts.append((0.0, 0.0, zs[ring]))
        for j in range(segments):
            jn = (j + 1) % S
            tri = (c, ring * S + j, ring * S + jn) if top else (c, ring * S + jn, ring * S + j)
            faces.append(tri)
            uvs += [(verts[v][0], verts[v][1]) for v in tri]

    # Drop vertices orphaned by skipped faces (jacket front opening).
    used = sorted({v for f in faces for v in f})
    remap = {old: new for new, old in enumerate(used)}
    verts = [verts[v] for v in used]
    faces = [tuple(remap[v] for v in f) for f in faces]
    return mesh_object(name, verts, faces, coll, mat, uvs)


def surface_strip(name, keys, coll, fn, nu, nv, mat=None, flip=False):
    """Grid conforming to a loft surface. fn(t, s) -> (angle, z, offset). Used for lapels, tie."""
    verts = []
    for iv in range(nv + 1):
        for iu in range(nu + 1):
            a, z, off = fn(iu / nu, iv / nv)
            verts.append(tuple(surface_point(keys, a, z, off)))
    faces, uvs = [], []
    W = nu + 1
    for iv in range(nv):
        for iu in range(nu):
            quad = [iv * W + iu, iv * W + iu + 1, (iv + 1) * W + iu + 1, (iv + 1) * W + iu]
            if flip:
                quad.reverse()
            faces.append(tuple(quad))
            for v in quad:
                x, y, z = verts[v]
                a = math.atan2(x, -y)
                rx, ry = sample_profile(keys, z)
                uvs.append((a * 0.5 * (rx + ry), z))
    return mesh_object(name, verts, faces, coll, mat, uvs)


def strip_frame(keys, fn, t, s, flip=False):
    """Point and outward normal of a surface_strip at (t, s). Drives the lapel push in."""
    e = 1e-3

    def p(tt, ss):
        a, z, off = fn(tt, ss)
        return surface_point(keys, a, z, off)

    dt = p(t + e, s) - p(t - e, s)
    ds = p(t, s + e) - p(t, s - e)
    n = dt.cross(ds).normalized()
    return p(t, s), (-n if flip else n)


def ellipsoid(name, radii, loc, coll, mat, rot=(0.0, 0.0, 0.0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0, calc_uvs=True)
    bmesh.ops.scale(bm, vec=Vector(radii), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    coll.objects.link(ob)
    set_material(ob, mat)
    return ob


def cylinder_mesh(name, r1, r2, depth, segments=32):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=r1, radius2=r2, depth=depth, calc_uvs=True)
    bm.to_mesh(me)
    bm.free()
    return me


_BOX_CACHE = {}


def box_mesh(size, bevel=0.0):
    """Boxes are built at real size so Object texture coordinates are in meters.
    Identical sizes share one mesh, which keeps hundreds of shelf items cheap."""
    key = (round(size[0], 4), round(size[1], 4), round(size[2], 4), round(bevel, 4))
    if key in _BOX_CACHE:
        return _BOX_CACHE[key]
    me = bpy.data.meshes.new(f"box_{key[0]}x{key[1]}x{key[2]}")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel,
                        segments=3, profile=0.5, affect="EDGES", clamp_overlap=True)
    bm.to_mesh(me)
    bm.free()
    if bevel > 0:
        me.shade_smooth()
    _BOX_CACHE[key] = me
    return me


def place(name, mesh, loc, coll, mat=None, rot=(0.0, 0.0, 0.0), parent=None):
    ob = bpy.data.objects.new(name, mesh)
    ob.location = loc
    ob.rotation_euler = rot
    if parent:
        ob.parent = parent
    coll.objects.link(ob)
    if mat:
        if not mesh.materials:
            mesh.materials.append(mat)
        elif mesh.materials[0] != mat:
            # Shared mesh, different finish: override per object instead of copying geometry.
            ob.material_slots[0].link = "OBJECT"
            ob.material_slots[0].material = mat
    return ob


# =============================================================================
# 1. CLEAR SCENE
# =============================================================================

def clear_scene():
    """Wipes scene data but keeps text blocks, so running from the Text Editor is safe."""
    scene = bpy.context.scene
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.lights, bpy.data.cameras,
                  bpy.data.images, bpy.data.node_groups, bpy.data.worlds, bpy.data.actions):
        for item in list(block):
            block.remove(item)
    bpy.data.orphans_purge(do_recursive=True)
    _BOX_CACHE.clear()
    scene.frame_start = 1
    scene.frame_end = FRAME_COUNT
    scene.frame_set(1)


# =============================================================================
# 2. MATERIALS
# =============================================================================

def new_material(name):
    mat = bpy.data.materials.new(name)
    if not mat.use_nodes:
        mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (900, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (550, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat, nt, bsdf


def setin(node, name, value):
    sock = node.inputs.get(name)
    if sock is None:
        log(f"warning: {node.bl_idname} has no input '{name}'")
        return
    sock.default_value = value


def node(nt, kind, loc, **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        setin(n, k.replace("_", " "), v)
    return n


def link(nt, src, dst):
    nt.links.new(src, dst)


def math_node(nt, op, loc, *args):
    """Math node; args are sockets or floats, fed to inputs 0..2 in order."""
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.location = loc
    for i, a in enumerate(args):
        if isinstance(a, (int, float)):
            n.inputs[i].default_value = a
        else:
            nt.links.new(a, n.inputs[i])
    return n.outputs[0]


def ramp(nt, loc, stops, interp="LINEAR"):
    n = nt.nodes.new("ShaderNodeValToRGB")
    n.location = loc
    cr = n.color_ramp
    cr.interpolation = interp

    def rgba(col):
        return (*col, 1.0) if len(col) == 3 else col

    # Set the two ends first, then insert middle stops at their final positions.
    # Moving existing elements past each other would re-sort them mid assignment.
    cr.elements[0].position, cr.elements[0].color = stops[0][0], rgba(stops[0][1])
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], rgba(stops[-1][1])
    for pos, col in stops[1:-1]:
        cr.elements.new(pos).color = rgba(col)
    return n


def wave(nt, loc, vec, direction, scale, distortion=0.5, detail=2.0):
    n = nt.nodes.new("ShaderNodeTexWave")
    n.location = loc
    n.wave_type = "BANDS"
    n.bands_direction = direction
    n.wave_profile = "SIN"
    setin(n, "Scale", scale)
    setin(n, "Distortion", distortion)
    setin(n, "Detail", detail)
    nt.links.new(vec, n.inputs["Vector"])
    return n


def noise(nt, loc, vec, scale, detail=4.0, roughness=0.55):
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.location = loc
    setin(n, "Scale", scale)
    setin(n, "Detail", detail)
    setin(n, "Roughness", roughness)
    if vec is not None:
        nt.links.new(vec, n.inputs["Vector"])
    return n


def fabric_material(name, dark, light, pitch, roughness, sheen, sheen_tint,
                    sheen_rough=0.4, twill=0.45, crease=0.22, spec=0.3):
    """Woven cloth on Principled BSDF.
    Height = plain weave (warp and weft bands selected by a checker at yarn pitch)
    blended with a 2/2 twill diagonal, plus fiber noise. Sheen carries the fuzz.
    A ridged low frequency noise adds soft creases through a second, chained bump."""
    mat, nt, bsdf = new_material(name)
    tc = node(nt, "ShaderNodeTexCoord", (-2200, 0))
    mp = node(nt, "ShaderNodeMapping", (-2000, 0))
    mp.inputs["Scale"].default_value = (WEAVE_UV_SCALE,) * 3
    link(nt, tc.outputs["UV"], mp.inputs["Vector"])
    vec = mp.outputs["Vector"]

    # Blender wave bands: period = 2*pi / (20 * scale). Solve for one yarn per period.
    k = 2.0 * math.pi / (20.0 * pitch)
    warp = wave(nt, (-1700, 300), vec, "X", k, distortion=0.35)
    weft = wave(nt, (-1700, 50), vec, "Y", k, distortion=0.35)
    twl = wave(nt, (-1700, -200), vec, "DIAGONAL", k, distortion=0.2)
    chk = node(nt, "ShaderNodeTexChecker", (-1700, -450), Scale=1.0 / pitch)
    link(nt, vec, chk.inputs["Vector"])

    diff = math_node(nt, "SUBTRACT", (-1450, 200), warp.outputs["Fac"], weft.outputs["Fac"])
    sel = math_node(nt, "MULTIPLY", (-1300, 200), chk.outputs["Fac"], diff)
    plain = math_node(nt, "ADD", (-1150, 200), weft.outputs["Fac"], sel)
    tw = math_node(nt, "MULTIPLY", (-1300, -200), twl.outputs["Fac"], twill)
    height = math_node(nt, "MULTIPLY_ADD", (-1000, 100), plain, 1.0 - twill, tw)
    fib = noise(nt, (-1300, -450), vec, 1.0 / (pitch * 0.3), detail=6.0, roughness=0.7)
    height2 = math_node(nt, "MULTIPLY_ADD", (-850, 0), fib.outputs["Fac"], 0.15, height)

    # Ridged noise: 1 - 2|n - 0.5|, sharpened. Reads as soft press lines, not blotches.
    cn = noise(nt, (-1300, -750), vec, 7.0, detail=3.0, roughness=0.5)
    c1 = math_node(nt, "SUBTRACT", (-1100, -750), cn.outputs["Fac"], 0.5)
    c2 = math_node(nt, "ABSOLUTE", (-950, -750), c1)
    c3 = math_node(nt, "MULTIPLY_ADD", (-800, -750), c2, -2.0, 1.0)
    ridge = math_node(nt, "POWER", (-650, -750), c3, 8.0)

    b_crease = node(nt, "ShaderNodeBump", (-400, -600), Strength=crease, Distance=0.004)
    link(nt, ridge, b_crease.inputs["Height"])
    b_weave = node(nt, "ShaderNodeBump", (-150, -400), Strength=0.45, Distance=pitch * 0.35)
    link(nt, height2, b_weave.inputs["Height"])
    link(nt, b_crease.outputs["Normal"], b_weave.inputs["Normal"])
    link(nt, b_weave.outputs["Normal"], bsdf.inputs["Normal"])

    # Melange: yarns are not one dye lot. Low amplitude color drift plus darker valleys.
    mel = noise(nt, (-1300, 600), vec, 1.0 / (pitch * 8.0), detail=2.0)
    mix = math_node(nt, "MULTIPLY_ADD", (-1000, 500), height, 0.4, mel.outputs["Fac"])
    col = ramp(nt, (-700, 500), [(0.25, dark), (1.0, light)])
    scaled = math_node(nt, "MULTIPLY", (-850, 500), mix, 0.7)
    link(nt, scaled, col.inputs["Fac"])
    link(nt, col.outputs["Color"], bsdf.inputs["Base Color"])

    setin(bsdf, "Roughness", roughness)
    setin(bsdf, "Specular IOR Level", spec)
    setin(bsdf, "Sheen Weight", sheen)
    setin(bsdf, "Sheen Roughness", sheen_rough)
    setin(bsdf, "Sheen Tint", (*sheen_tint, 1.0))
    return mat


def build_materials():
    mats = {}

    mats["wool"] = fabric_material(
        "MAT_Wool_Navy_Worsted", dark=(0.010, 0.014, 0.032), light=(0.030, 0.040, 0.085),
        pitch=WOOL_YARN_PITCH_M, roughness=0.58, sheen=0.55, sheen_tint=(0.55, 0.62, 0.80))
    mats["shirt"] = fabric_material(
        "MAT_Shirt_Cotton_Poplin", dark=(0.70, 0.71, 0.70), light=(0.86, 0.86, 0.84),
        pitch=0.00012, roughness=0.5, sheen=0.35, sheen_tint=(1, 1, 1), twill=0.0, crease=0.12)
    mats["pocket"] = fabric_material(
        "MAT_PocketSquare_Linen", dark=(0.74, 0.73, 0.69), light=(0.88, 0.87, 0.83),
        pitch=0.0004, roughness=0.62, sheen=0.3, sheen_tint=(1, 1, 1), twill=0.0, crease=0.3)

    # Silk tie: anisotropic specular. Tangent follows the UV u axis (around the body),
    # rotated 90 degrees so the stretched highlight runs along the blade like real silk.
    mat, nt, bsdf = new_material("MAT_Tie_Silk")
    tan = node(nt, "ShaderNodeTangent", (200, -400))
    tan.direction_type = "UV_MAP"
    tan.uv_map = "UVMap"
    link(nt, tan.outputs["Tangent"], bsdf.inputs["Tangent"])
    tc = node(nt, "ShaderNodeTexCoord", (-700, -200))
    vor = node(nt, "ShaderNodeTexVoronoi", (-450, -200), Scale=1800.0)
    link(nt, tc.outputs["UV"], vor.inputs["Vector"])
    bump = node(nt, "ShaderNodeBump", (0, -200), Strength=0.15, Distance=0.0001)
    link(nt, vor.outputs["Distance"], bump.inputs["Height"])
    link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])
    setin(bsdf, "Base Color", (0.012, 0.010, 0.018, 1))
    setin(bsdf, "Roughness", 0.28)
    setin(bsdf, "Anisotropic", 0.8)
    setin(bsdf, "Anisotropic Rotation", 0.25)
    setin(bsdf, "Specular IOR Level", 0.55)
    setin(bsdf, "Sheen Weight", 0.15)
    mats["silk"] = mat

    # Mannequin: warm off white satin lacquer. Faint orange peel keeps it from looking CG.
    mat, nt, bsdf = new_material("MAT_Mannequin_Satin")
    nz = noise(nt, (-500, -200), None, 900.0, detail=2.0)
    bump = node(nt, "ShaderNodeBump", (0, -200), Strength=0.04, Distance=0.0003)
    link(nt, nz.outputs["Fac"], bump.inputs["Height"])
    link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])
    setin(bsdf, "Base Color", (0.72, 0.66, 0.56, 1))
    setin(bsdf, "Roughness", 0.34)
    setin(bsdf, "Specular IOR Level", 0.5)
    setin(bsdf, "Coat Weight", 0.15)
    setin(bsdf, "Coat Roughness", 0.25)
    mats["satin"] = mat

    # Brass: metallic, roughness wanders 0.16 to 0.32 like hand polished hardware.
    mat, nt, bsdf = new_material("MAT_Brass")
    tc = node(nt, "ShaderNodeTexCoord", (-900, 0))
    nz = noise(nt, (-650, 0), tc.outputs["Object"], 18.0, detail=6.0)
    rr = ramp(nt, (-350, 0), [(0.35, (0.16, 0.16, 0.16)), (0.7, (0.32, 0.32, 0.32))])
    link(nt, nz.outputs["Fac"], rr.inputs["Fac"])
    link(nt, rr.outputs["Color"], bsdf.inputs["Roughness"])
    setin(bsdf, "Base Color", (0.80, 0.57, 0.24, 1))
    setin(bsdf, "Metallic", 1.0)
    mats["brass"] = mat

    mat, nt, bsdf = new_material("MAT_Button_Horn")
    setin(bsdf, "Base Color", (0.020, 0.012, 0.008, 1))
    setin(bsdf, "Roughness", 0.25)
    setin(bsdf, "Coat Weight", 0.5)
    mats["horn"] = mat

    # Travertine: 1.2 x 0.6 m tiles, banded strata, scattered pits, near mirror polish.
    mat, nt, bsdf = new_material("MAT_Travertine_Polished")
    tc = node(nt, "ShaderNodeTexCoord", (-1800, 0))
    obj = tc.outputs["Object"]
    brick = node(nt, "ShaderNodeTexBrick", (-1500, 400), Scale=1.0, Mortar_Size=0.0025,
                 Mortar_Smooth=0.2, Brick_Width=1.2, Row_Height=0.6)
    link(nt, obj, brick.inputs["Vector"])
    strata = wave(nt, (-1500, 100), obj, "X", 0.35, distortion=8.0, detail=6.0)
    setin(strata, "Detail Scale", 1.5)
    nz = noise(nt, (-1500, -150), obj, 3.0, detail=8.0)
    vor = node(nt, "ShaderNodeTexVoronoi", (-1500, -400), Scale=45.0)
    link(nt, obj, vor.inputs["Vector"])
    nz2 = noise(nt, (-1500, -650), obj, 9.0, detail=2.0)
    pit_shape = node(nt, "ShaderNodeMapRange", (-1200, -400))
    setin(pit_shape, "From Min", 0.02)
    setin(pit_shape, "From Max", 0.09)
    setin(pit_shape, "To Min", 1.0)
    setin(pit_shape, "To Max", 0.0)
    link(nt, vor.outputs["Distance"], pit_shape.inputs["Value"])
    pit_mask = node(nt, "ShaderNodeMapRange", (-1200, -650))
    setin(pit_mask, "From Min", 0.5)
    setin(pit_mask, "From Max", 0.6)
    link(nt, nz2.outputs["Fac"], pit_mask.inputs["Value"])
    pits = math_node(nt, "MULTIPLY", (-1000, -500), pit_shape.outputs["Result"], pit_mask.outputs["Result"])
    grout = brick.outputs["Fac"]
    pat = math_node(nt, "MULTIPLY_ADD", (-1100, 50), strata.outputs["Fac"], 0.6,
                    math_node(nt, "MULTIPLY", (-1250, -150), nz.outputs["Fac"], 0.4))
    p1 = math_node(nt, "MULTIPLY_ADD", (-850, 0), pits, -0.35, pat)
    p2 = math_node(nt, "MULTIPLY_ADD", (-700, 0), grout, -0.5, p1)
    col = ramp(nt, (-500, 200), [(0.15, (0.36, 0.29, 0.21)), (0.5, (0.62, 0.52, 0.40)),
                                 (0.85, (0.76, 0.68, 0.56))])
    link(nt, p2, col.inputs["Fac"])
    link(nt, col.outputs["Color"], bsdf.inputs["Base Color"])
    r1 = math_node(nt, "MULTIPLY_ADD", (-700, -250), pits, 0.25, 0.07)
    r2 = math_node(nt, "MULTIPLY_ADD", (-550, -250), grout, 0.3, r1)
    r3 = math_node(nt, "MULTIPLY_ADD", (-400, -250), nz.outputs["Fac"], 0.04, r2)
    link(nt, r3, bsdf.inputs["Roughness"])
    h1 = math_node(nt, "ADD", (-700, -500), pits, grout)
    h2 = math_node(nt, "SUBTRACT", (-550, -500), 1.0, h1)
    bump = node(nt, "ShaderNodeBump", (-300, -500), Strength=0.3, Distance=0.002)
    link(nt, h2, bump.inputs["Height"])
    link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])
    mats["travertine"] = mat

    # Walnut: vertical grain, each panel offset by Object Info Random so no two match.
    mat, nt, bsdf = new_material("MAT_Walnut_Lacquered")
    tc = node(nt, "ShaderNodeTexCoord", (-1400, 0))
    oi = node(nt, "ShaderNodeObjectInfo", (-1400, -300))
    off = math_node(nt, "MULTIPLY", (-1200, -300), oi.outputs["Random"], 37.0)
    mp = node(nt, "ShaderNodeMapping", (-1000, 0))
    mp.inputs["Scale"].default_value = (1.0, 1.0, 0.08)
    link(nt, tc.outputs["Object"], mp.inputs["Vector"])
    link(nt, off, mp.inputs["Location"])
    grain = wave(nt, (-750, 0), mp.outputs["Vector"], "X", 6.0, distortion=7.0, detail=4.0)
    col = ramp(nt, (-450, 200), [(0.1, (0.035, 0.018, 0.010)), (0.55, (0.075, 0.040, 0.022)),
                                 (0.95, (0.13, 0.075, 0.040))])
    link(nt, grain.outputs["Fac"], col.inputs["Fac"])
    link(nt, col.outputs["Color"], bsdf.inputs["Base Color"])
    bump = node(nt, "ShaderNodeBump", (-200, -300), Strength=0.08, Distance=0.001)
    link(nt, grain.outputs["Fac"], bump.inputs["Height"])
    link(nt, bump.outputs["Normal"], bsdf.inputs["Normal"])
    setin(bsdf, "Roughness", 0.4)
    setin(bsdf, "Coat Weight", 0.35)
    setin(bsdf, "Coat Roughness", 0.12)
    mats["walnut"] = mat

    mat, nt, bsdf = new_material("MAT_Plaster_Dark")
    setin(bsdf, "Base Color", (0.060, 0.050, 0.045, 1))
    setin(bsdf, "Roughness", 0.85)
    mats["plaster"] = mat

    # Folded garments: one material, muted palette chosen per object by Object Info Random.
    mat, nt, bsdf = new_material("MAT_Folded_Garments")
    oi = node(nt, "ShaderNodeObjectInfo", (-700, 0))
    pal = ramp(nt, (-450, 0), [(0.0, (0.030, 0.030, 0.032)), (0.17, (0.30, 0.20, 0.11)),
                               (0.34, (0.62, 0.58, 0.50)), (0.51, (0.015, 0.020, 0.045)),
                               (0.68, (0.10, 0.10, 0.07)), (0.85, (0.18, 0.18, 0.18))],
               interp="CONSTANT")
    link(nt, oi.outputs["Random"], pal.inputs["Fac"])
    link(nt, pal.outputs["Color"], bsdf.inputs["Base Color"])
    setin(bsdf, "Roughness", 0.85)
    setin(bsdf, "Sheen Weight", 0.6)
    mats["garments"] = mat

    # Practical lamp shades: 2600 K blackbody emission, the warm points in the bokeh.
    mat, nt, bsdf = new_material("MAT_Lamp_Shade_Glow")
    bb = node(nt, "ShaderNodeBlackbody", (100, -300), Temperature=2600.0)
    link(nt, bb.outputs["Color"], bsdf.inputs["Emission Color"])
    setin(bsdf, "Base Color", (0.9, 0.8, 0.65, 1))
    setin(bsdf, "Emission Strength", 12.0)
    setin(bsdf, "Roughness", 0.6)
    mats["shade"] = mat
    return mats


# =============================================================================
# 3. MANNEQUIN AND SUIT (IMPORT OR PLACEHOLDER)
# =============================================================================

# Body profiles, meters. Figure is 1.85 m, facing -Y.
TORSO = [(0.86, 0.150, 0.100), (0.95, 0.170, 0.110), (1.05, 0.150, 0.100),
         (1.15, 0.155, 0.105), (1.28, 0.170, 0.120), (1.38, 0.180, 0.120),
         (1.46, 0.190, 0.105), (1.52, 0.120, 0.080), (1.56, 0.060, 0.055)]
SHIRT = [(z, rx + 0.008, ry + 0.008) for (z, rx, ry) in TORSO if z >= 0.95]
JACKET = [(0.78, 0.185, 0.135), (0.90, 0.190, 0.140), (1.05, 0.175, 0.130),
          (1.20, 0.180, 0.140), (1.30, 0.195, 0.150), (1.40, 0.205, 0.145),
          (1.47, 0.215, 0.125), (1.52, 0.150, 0.100), (1.56, 0.075, 0.070)]
ARM = [(-0.58, 0.025, 0.025), (-0.56, 0.026, 0.026), (-0.42, 0.036, 0.036),
       (-0.30, 0.037, 0.037), (-0.27, 0.036, 0.036), (-0.10, 0.046, 0.046),
       (0.0, 0.048, 0.048), (0.03, 0.050, 0.050)]
SLEEVE = [(-0.545, 0.050, 0.050), (-0.45, 0.052, 0.052), (-0.29, 0.056, 0.056),
          (-0.15, 0.062, 0.062), (0.0, 0.068, 0.068), (0.05, 0.070, 0.070)]
CUFF = [(-0.575, 0.032, 0.032), (-0.52, 0.034, 0.034)]
LEG = [(-0.84, 0.032, 0.032), (-0.80, 0.033, 0.033), (-0.62, 0.052, 0.052),
       (-0.50, 0.050, 0.050), (-0.45, 0.048, 0.048), (-0.25, 0.070, 0.070),
       (0.0, 0.088, 0.088), (0.04, 0.090, 0.090)]
TROUSER = [(-0.86, 0.092, 0.092), (-0.70, 0.088, 0.088), (-0.45, 0.085, 0.085),
           (-0.25, 0.095, 0.095), (0.0, 0.108, 0.108), (0.10, 0.110, 0.110)]
SEAT = [(0.80, 0.180, 0.120), (0.95, 0.188, 0.128), (1.02, 0.168, 0.118)]

# Limb rigs: (origin, euler). Weight sits on the wearer's left leg (+X); the right leg
# relaxes outward and forward, which is what reads as a natural standing pose.
LEG_RIG = {"L": ((0.09, 0.0, 0.92), (0.0, 0.0, 0.0)),
           "R": ((-0.09, 0.0, 0.92), (math.radians(-3.0), math.radians(4.0), 0.0))}
ARM_RIG = {"L": ((0.20, 0.0, 1.44), (math.radians(-4.0), math.radians(-7.0), 0.0)),
           "R": ((-0.20, 0.0, 1.44), (math.radians(-7.0), math.radians(8.0), 0.0))}


def v_halfwidth(z):
    """Half angle of the jacket's front V opening, from the button stance up to the collar."""
    if z <= 1.10:
        return 0.0
    return 0.50 * min(1.0, (z - 1.10) / 0.40) ** 0.9


def cutaway(z):
    """Single breasted quarters curve open below the lower button."""
    return 0.30 * (0.93 - z) / 0.15 if z < 0.93 else 0.0


def lapel_fn(side):
    """Peak lapel as (t across, s along). Inner edge is the V, outer tip rises into the peak."""
    def fn(t, s):
        z_top = 1.405 + 0.06 * t ** 1.5
        z = 1.10 + s * (z_top - 1.10)
        w = 0.004 + 0.091 * min(1.0, max(0.0, (z - 1.10) / 0.28)) ** 0.7
        a_in = v_halfwidth(z)
        a = a_in + t * w / arc_speed(JACKET, a_in, z)
        return side * a, z, 0.006 + 0.004 * t
    return fn


def tie_fn(t, s):
    z_bot = 1.075 + 0.04 * abs(2.0 * t - 1.0)   # pointed blade tip
    z = z_bot + s * (1.565 - z_bot)
    if z > 1.515:
        w = 0.042                                # knot
    elif z > 1.49:
        w = 0.032 + (z - 1.49) / 0.025 * 0.010
    else:
        w = min(0.085, 0.032 + (1.49 - z) / 0.39 * 0.053)
    rx, _ = sample_profile(SHIRT, z)
    off = 0.004 + 0.012 * smoothstep((z - 1.49) / 0.03)
    return (t - 0.5) * w / rx, z, off


def limb(name, keys, rig, coll, mat, **kw):
    ob = loft(name, keys, coll, mat, segments=32, **kw)
    ob.location, ob.rotation_euler = rig
    return ob


def build_placeholder_mannequin(coll, mats):
    satin = mats["satin"]
    parts = [loft("PH_Mannequin_Torso", TORSO, coll, satin, cap_bottom=True),
             loft("PH_Mannequin_Neck", [(1.50, 0.055, 0.052), (1.64, 0.050, 0.048)], coll, satin)]
    parts.append(ellipsoid("PH_Mannequin_Head_Faceless", (0.075, 0.09, 0.115),
                           (0.0, 0.005, 1.73), coll, satin))
    for side, (origin, rot) in LEG_RIG.items():
        leg = limb(f"PH_Mannequin_Leg_{side}", LEG, (origin, rot), coll, satin, cap_bottom=True)
        ankle = leg.matrix_basis @ Vector((0, 0, -0.84))
        parts.append(leg)
        parts.append(ellipsoid(f"PH_Mannequin_Foot_{side}", (0.045, 0.12, 0.035),
                               (ankle.x, ankle.y - 0.05, 0.045), coll, satin))
    for side, (origin, rot) in ARM_RIG.items():
        arm = limb(f"PH_Mannequin_Arm_{side}", ARM, (origin, rot), coll, satin, cap_bottom=True)
        wrist = arm.matrix_basis @ Vector((0, 0, -0.63))
        parts.append(arm)
        parts.append(ellipsoid(f"PH_Mannequin_Hand_{side}", (0.025, 0.045, 0.09),
                               tuple(wrist), coll, satin, rot=rot))
    base = place("PH_Mannequin_Base_Brass", cylinder_mesh("base_disk", 0.32, 0.32, 0.015, 64),
                 (0, 0, 0.0075), coll, mats["brass"])
    parts.append(base)
    for ob in parts:
        if ob.type == "MESH" and not ob.name.startswith("PH_Mannequin_Base"):
            add_subsurf(ob)
    return parts


def build_placeholder_suit(coll, mats):
    wool, shirt_m = mats["wool"], mats["shirt"]
    objs = {}

    jacket = loft("PH_Suit_Jacket", JACKET, coll, wool, segments=64, step=0.008,
                  skip=lambda a, z: abs(a) < max(v_halfwidth(z), cutaway(z)),
                  ripples=[dict(z=(0.98, 1.12), amp=0.02, wl=0.035, side=0.0, seed=1.0),
                           dict(z=(0.78, 0.86), amp=0.012, wl=0.03, seed=2.0)])
    objs["jacket"] = jacket

    for side, sign in (("L", 1.0), ("R", -1.0)):
        lap = surface_strip(f"PH_Suit_Lapel_{side}", JACKET, coll, lapel_fn(sign), 14, 48,
                            wool, flip=sign < 0)
        add_solidify(lap, 0.004)
        objs[f"lapel_{side}"] = lap

    shirt = loft("PH_Suit_Shirt", SHIRT, coll, shirt_m, segments=48)
    collar = loft("PH_Suit_Shirt_Collar", [(1.53, 0.070, 0.064), (1.63, 0.062, 0.058)], coll,
                  shirt_m, skip=lambda a, z: abs(a) < 0.12 * (z - 1.53) / 0.10)
    add_solidify(collar, 0.002)
    tie = surface_strip("PH_Suit_Tie", SHIRT, coll, tie_fn, 10, 60, mats["silk"])
    add_solidify(tie, 0.003)
    objs.update(shirt=shirt, collar=collar, tie=tie)

    welt = surface_strip("PH_Suit_BreastWelt", JACKET, coll,
                         lambda t, s: (lerp(0.78, 1.10, t), lerp(1.300, 1.316, s), 0.003),
                         8, 2, wool)
    square = surface_strip("PH_Suit_PocketSquare", JACKET, coll,
                           lambda t, s: (lerp(0.80, 1.06, t), lerp(1.312, 1.338, s), 0.007),
                           8, 3, mats["pocket"])
    add_solidify(square, 0.003)
    objs.update(welt=welt, pocket_square=square)

    for i, z in enumerate((1.06, 0.95)):
        p = surface_point(JACKET, 0.0, z, 0.004)
        n = Vector((0, -1, 0))
        objs[f"button_{i}"] = place(f"PH_Suit_Button_{i + 1}",
                                    cylinder_mesh(f"button_{i}", 0.0095, 0.0095, 0.004, 24),
                                    p, coll, mats["horn"],
                                    rot=n.to_track_quat("Z", "Y").to_euler())

    for side, rig in ARM_RIG.items():
        objs[f"sleeve_{side}"] = limb(
            f"PH_Suit_Sleeve_{side}", SLEEVE, rig, coll, wool,
            ripples=[dict(z=(-0.36, -0.22), amp=0.06, wl=0.025, side=0.0, seed=3.0),
                     dict(z=(-0.545, -0.47), amp=0.03, wl=0.02, seed=4.0)])
        objs[f"cuff_{side}"] = limb(f"PH_Suit_Shirt_Cuff_{side}", CUFF, rig, coll, shirt_m)
    for side, rig in LEG_RIG.items():
        objs[f"trouser_{side}"] = limb(
            f"PH_Suit_Trouser_{side}", TROUSER, rig, coll, wool,
            ripples=[dict(z=(-0.86, -0.74), amp=0.05, wl=0.04, side=0.0, seed=5.0),
                     dict(z=(-0.52, -0.40), amp=0.015, wl=0.03, side=math.pi, seed=6.0)])
    objs["seat"] = loft("PH_Suit_Trouser_Seat", SEAT, coll, wool)

    for key, ob in objs.items():
        if ob.type == "MESH" and not key.startswith(("button", "lapel", "welt")):
            add_subsurf(ob)

    lapel_point, lapel_normal = strip_frame(JACKET, lapel_fn(1.0), 0.55, 0.5)
    return objs, lapel_point, lapel_normal


def import_asset(path, coll):
    path = bpy.path.abspath(path)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Asset not found: {path}")
    ext = os.path.splitext(path)[1].lower()
    before = set(bpy.data.objects)
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".blend":
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                coll.objects.link(ob)
    else:
        raise ValueError(f"Unsupported asset type '{ext}' for {path}")
    new = [ob for ob in bpy.data.objects if ob not in before]
    for ob in new:
        move_to_collection(ob, coll)
    log(f"imported {len(new)} objects from {path}")
    return new


def material_for_imported(name, mats):
    n = name.lower()
    if "tie" in n:
        return mats["silk"]
    if "pocket" in n or "square" in n:
        return mats["pocket"]
    if "shirt" in n or "collar" in n or "cuff" in n:
        return mats["shirt"]
    if "button" in n:
        return mats["horn"]
    return mats["wool"]


def import_or_placeholder(colls, mats):
    rig = {"jacket": None, "colliders": []}

    if MANNEQUIN_PATH:
        body = [o for o in import_asset(MANNEQUIN_PATH, colls["Mannequin"]) if o.type == "MESH"]
        for ob in body:
            set_material(ob, mats["satin"])
    else:
        body = build_placeholder_mannequin(colls["Mannequin"], mats)

    if SUIT_PATH:
        suit = [o for o in import_asset(SUIT_PATH, colls["Suit"]) if o.type == "MESH"]
        for ob in suit:
            set_material(ob, material_for_imported(ob.name, mats))
        rig["jacket"] = next((o for o in suit if CLOTH_OBJECT_KEYWORD in o.name.lower()), None)
        rig["colliders"] = body
        if LAPEL_POINT is None or LAPEL_NORMAL is None:
            log("warning: imported suit without LAPEL_POINT/LAPEL_NORMAL. Using a default "
                "estimate; the final frames may miss the lapel. Set both from your asset.")
        lp = Vector(LAPEL_POINT or (0.085, -0.140, 1.264))
        ln = Vector(LAPEL_NORMAL or (0.34, -0.93, 0.10))
    else:
        objs, lp, ln = build_placeholder_suit(colls["Suit"], mats)
        rig["jacket"] = objs["jacket"]
        # Arms cross the jacket at the shoulders, so only shirt and seat act as colliders.
        rig["colliders"] = [objs["shirt"], objs["seat"]]
        if LAPEL_POINT is not None and LAPEL_NORMAL is not None:
            lp, ln = Vector(LAPEL_POINT), Vector(LAPEL_NORMAL)

    rig["lapel_point"] = lp
    rig["lapel_normal"] = ln.normalized()
    log(f"lapel focus point {tuple(round(c, 4) for c in lp)}, "
        f"normal {tuple(round(c, 3) for c in rig['lapel_normal'])}")
    return rig


# =============================================================================
# 4. CLOTH SIMULATION (OPTIONAL)
# =============================================================================

def run_cloth_sim(rig):
    """Drape, then FREEZE. The mannequin never moves, so a live cloth cache would only add
    risk: any solver jitter between frames becomes visible flicker when users scrub slowly.
    Instead the jacket is simulated for CLOTH_SETTLE_FRAMES and the settled shape is written
    back into the mesh. Every rendered frame sees identical, fully baked geometry."""
    jacket = rig["jacket"]
    if jacket is None:
        log(f"warning: USE_CLOTH_SIM is on but no object named '*{CLOTH_OBJECT_KEYWORD}*' "
            "was found. Skipping cloth.")
        return
    scene = bpy.context.scene

    kept = any(m.type == "SUBSURF" for m in jacket.modifiers)
    for m in list(jacket.modifiers):
        jacket.modifiers.remove(m)

    vg = jacket.vertex_groups.new(name="Pin")
    vg.add([v.index for v in jacket.data.vertices if v.co.z > CLOTH_PIN_HEIGHT], 1.0, "REPLACE")

    for ob in rig["colliders"]:
        ob.modifiers.new("Collision", "COLLISION")
        ob.collision.thickness_outer = 0.003
        ob.collision.cloth_friction = 8.0

    cloth = jacket.modifiers.new("Cloth", "CLOTH")
    st = cloth.settings
    st.quality = 10
    st.mass = 0.35                 # medium weight worsted, about 260 g per m2
    st.air_damping = 1.0
    st.tension_stiffness = 40.0
    st.compression_stiffness = 40.0
    st.shear_stiffness = 15.0
    st.bending_stiffness = 6.0     # canvassed suit fronts resist folding
    st.vertex_group_mass = "Pin"
    cs = cloth.collision_settings
    cs.collision_quality = 4
    cs.distance_min = 0.003
    cs.use_self_collision = False
    cloth.point_cache.frame_start = 1
    cloth.point_cache.frame_end = CLOTH_SETTLE_FRAMES

    log(f"simulating cloth for {CLOTH_SETTLE_FRAMES} frames")
    for f in range(1, CLOTH_SETTLE_FRAMES + 1):
        scene.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(jacket.evaluated_get(dg),
                                            preserve_all_data_layers=True, depsgraph=dg)
    old = jacket.data
    jacket.modifiers.clear()
    jacket.data = baked
    bpy.data.meshes.remove(old)
    baked.shade_smooth()
    if kept:
        add_subsurf(jacket)
    for ob in rig["colliders"]:
        for m in [m for m in ob.modifiers if m.type == "COLLISION"]:
            ob.modifiers.remove(m)
    scene.frame_set(1)
    log("cloth settled and frozen into the jacket mesh")


# =============================================================================
# 5. ENVIRONMENT
# =============================================================================

def build_shelf_unit(name, parent, coll, mats, rng):
    W, H, D, T = 1.8, 2.4, 0.45, 0.03
    walnut = mats["walnut"]
    place(f"{name}_Side_L", box_mesh((T, D, H)), (-W / 2, 0, H / 2), coll, walnut, parent=parent)
    place(f"{name}_Side_R", box_mesh((T, D, H)), (W / 2, 0, H / 2), coll, walnut, parent=parent)
    place(f"{name}_Back", box_mesh((W, T, H)), (0, -D / 2, H / 2), coll, walnut, parent=parent)
    garment = box_mesh((0.34, 0.26, 0.05), bevel=0.012)
    for k, z in enumerate((0.08, 0.55, 1.02, 1.49, 1.96, 2.385)):
        place(f"{name}_Shelf_{k}", box_mesh((W, D, T)), (0, 0, z), coll, walnut, parent=parent)
        if z > 2.3:
            continue
        for sx in (-0.55, 0.0, 0.55):
            for g in range(rng.randint(3, 6)):
                place(f"{name}_Garment_{k}_{sx}_{g}", garment,
                      (sx + rng.uniform(-0.006, 0.006), 0.02 + rng.uniform(-0.006, 0.006),
                       z + T / 2 + 0.025 + g * 0.05),
                      coll, mats["garments"], rot=(0, 0, math.radians(rng.uniform(-2, 2))),
                      parent=parent)


def build_sconce(name, parent, coll, mats):
    place(f"{name}_Plate", box_mesh((0.12, 0.02, 0.2)), (0, 0.01, 0), coll, mats["brass"],
          parent=parent)
    place(f"{name}_Arm", cylinder_mesh(f"{name}_arm", 0.008, 0.008, 0.2),
          (0, 0.11, 0), coll, mats["brass"], rot=(math.radians(90), 0, 0), parent=parent)
    place(f"{name}_Shade", cylinder_mesh(f"{name}_shade", 0.07, 0.07, 0.18),
          (0, 0.21, 0.02), coll, mats["shade"], parent=parent)


def build_floor_lamp(name, loc, coll, mats):
    place(f"{name}_Base", cylinder_mesh(f"{name}_base", 0.18, 0.18, 0.02), (loc[0], loc[1], 0.01),
          coll, mats["brass"])
    place(f"{name}_Pole", cylinder_mesh(f"{name}_pole", 0.012, 0.012, 1.5),
          (loc[0], loc[1], 0.77), coll, mats["brass"])
    place(f"{name}_Shade", cylinder_mesh(f"{name}_shade", 0.2, 0.14, 0.28),
          (loc[0], loc[1], 1.66), coll, mats["shade"])


def build_environment(colls, mats):
    coll = colls["Environment"]
    rng = random.Random(RNG_SEED)
    span = 2 * ROOM_HALF

    place("ENV_Floor_Travertine", box_mesh((span, span, 0.02)), (0, 0, -0.01), coll,
          mats["travertine"])

    # Each wall gets a local frame: x along the wall, +y into the room, z up.
    walls = {"S": ((0, -ROOM_HALF, 0), 0.0), "N": ((0, ROOM_HALF, 0), math.pi),
             "W": ((-ROOM_HALF, 0, 0), -math.pi / 2), "E": ((ROOM_HALF, 0, 0), math.pi / 2)}
    for key, (loc, rot_z) in walls.items():
        frame = bpy.data.objects.new(f"ENV_Wall_{key}", None)
        frame.location = loc
        frame.rotation_euler = (0, 0, rot_z)
        coll.objects.link(frame)
        place(f"ENV_Wall_{key}_Backing", box_mesh((span, 0.1, ROOM_HEIGHT)),
              (0, -0.05, ROOM_HEIGHT / 2), coll, mats["plaster"], parent=frame)
        n_panels = int(span / 1.2)
        for k in range(n_panels):
            x = -span / 2 + 0.6 + k * 1.2
            place(f"ENV_Wall_{key}_Panel_{k}", box_mesh((1.17, 0.03, 3.3)), (x, 0.015, 1.77),
                  coll, mats["walnut"], parent=frame)
            if k < n_panels - 1:
                place(f"ENV_Wall_{key}_BrassInlay_{k}", box_mesh((0.012, 0.035, 3.3)),
                      (x + 0.6, 0.0175, 1.77), coll, mats["brass"], parent=frame)
        place(f"ENV_Wall_{key}_BrassRail", box_mesh((span, 0.04, 0.02)), (0, 0.02, 3.45),
              coll, mats["brass"], parent=frame)
        place(f"ENV_Wall_{key}_BrassSkirting", box_mesh((span, 0.02, 0.1)), (0, 0.04, 0.05),
              coll, mats["brass"], parent=frame)
        for i, x in enumerate((-3.0, 3.0)):
            unit = bpy.data.objects.new(f"ENV_Wall_{key}_Shelving_{i}", None)
            unit.parent = frame
            unit.location = (x, 0.26, 0.0)
            coll.objects.link(unit)
            build_shelf_unit(f"ENV_Wall_{key}_Shelving_{i}", unit, coll, mats, rng)
        for i, x in enumerate((-6.0, 0.0, 6.0)):
            sc = bpy.data.objects.new(f"ENV_Wall_{key}_Sconce_{i}", None)
            sc.parent = frame
            sc.location = (x, 0.03, 2.3)
            coll.objects.link(sc)
            build_sconce(f"ENV_Wall_{key}_Sconce_{i}", sc, coll, mats)

    for i, (x, y) in enumerate(((-6.8, -6.8), (6.8, -6.8), (-6.8, 6.8), (6.8, 6.8))):
        build_floor_lamp(f"ENV_FloorLamp_{i}", (x, y), coll, mats)


# =============================================================================
# 6. LIGHTING AND WORLD
# =============================================================================

def area_light(name, coll, loc, aim, energy, color, size, size_y=None, spread_deg=180.0):
    ld = bpy.data.lights.new(name, "AREA")
    ld.energy = energy
    ld.color = color
    if size_y is None:
        ld.shape = "SQUARE"
        ld.size = size
    else:
        ld.shape = "RECTANGLE"
        ld.size = size
        ld.size_y = size_y
    ld.spread = math.radians(spread_deg)
    ob = bpy.data.objects.new(name, ld)
    ob.location = loc
    ob.rotation_euler = (Vector(aim) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    ob.visible_camera = False       # light cards must never appear in frame during the orbit
    coll.objects.link(ob)
    return ob


def build_lighting(colls):
    coll = colls["Lighting"]
    # Large soft key, front left and high: sculpts lapels and shoulder line.
    area_light("LGT_Key_Soft", coll, (-2.2, -3.0, 3.4), (0, 0, 1.3), 1100.0,
               (1.0, 0.96, 0.90), 2.4, 1.6)
    # Warm rims. A 180 degree orbit sees both sides of the figure, so one rim per side
    # keeps the silhouette separated for the whole move. Unequal power keeps it natural.
    area_light("LGT_Rim_Warm_R", coll, (2.4, 1.2, 2.2), (0, 0, 1.2), 500.0,
               (1.0, 0.80, 0.58), 0.5, 2.4, spread_deg=60.0)
    area_light("LGT_Rim_Warm_L", coll, (-2.4, 1.6, 2.4), (0, 0, 1.2), 380.0,
               (1.0, 0.80, 0.58), 0.5, 2.4, spread_deg=60.0)
    # Subtle bounce fill, low and wide, lifts the navy out of pure black.
    area_light("LGT_Fill_Bounce", coll, (2.6, -2.6, 0.9), (0, 0, 1.1), 120.0,
               (1.0, 0.93, 0.85), 3.0)


def build_world():
    """HDRI for reflections only: glossy rays see the HDRI, every other ray sees a dim
    warm tone. The room has no ceiling on purpose; that opening is where the HDRI reaches
    the wool sheen, brass and stone, like a large overhead softbox."""
    world = bpy.data.worlds.new("WORLD_Studio_Reflections")
    bpy.context.scene.world = world
    if not world.use_nodes:
        world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    out = node(nt, "ShaderNodeOutputWorld", (600, 0))
    mix = node(nt, "ShaderNodeMixShader", (400, 0))
    lp = node(nt, "ShaderNodeLightPath", (100, 300))
    dim = node(nt, "ShaderNodeBackground", (100, 0), Color=(0.035, 0.03, 0.027, 1.0),
               Strength=1.0)
    refl = node(nt, "ShaderNodeBackground", (100, -200), Strength=HDRI_STRENGTH)
    if HDRI_PATH:
        path = bpy.path.abspath(HDRI_PATH)
        if not os.path.isfile(path):
            raise FileNotFoundError(f"HDRI not found: {path}")
        tc = node(nt, "ShaderNodeTexCoord", (-600, -200))
        mp = node(nt, "ShaderNodeMapping", (-400, -200))
        mp.inputs["Rotation"].default_value = (0, 0, math.radians(HDRI_ROTATION_DEG))
        env = node(nt, "ShaderNodeTexEnvironment", (-150, -200))
        env.image = bpy.data.images.load(path, check_existing=True)
        link(nt, tc.outputs["Generated"], mp.inputs["Vector"])
        link(nt, mp.outputs["Vector"], env.inputs["Vector"])
        link(nt, env.outputs["Color"], refl.inputs["Color"])
    else:
        log("HDRI_PATH empty: glossy reflections see flat neutral grey (no HDRI substituted)")
        setin(refl, "Color", (0.5, 0.5, 0.5, 1.0))
    link(nt, lp.outputs["Is Glossy Ray"], mix.inputs["Fac"])
    link(nt, dim.outputs["Background"], mix.inputs[1])
    link(nt, refl.outputs["Background"], mix.inputs[2])
    link(nt, mix.outputs["Shader"], out.inputs["Surface"])


# =============================================================================
# 7. CAMERAS (LINEAR SCROLL PATH)
# =============================================================================

def push_amount(frame):
    """0 during the orbit, then 0..1 linearly across the push in."""
    if frame <= PUSH_START_FRAME:
        return 0.0
    return (frame - PUSH_START_FRAME) / (FRAME_COUNT - PUSH_START_FRAME)


def build_camera_animation(colls, rig):
    """Every frame is keyed explicitly with LINEAR interpolation, so the motion is exactly
    the formula below with no ease anywhere. Scroll position is the only pacing.

    Azimuth advances at a constant rate across all 180 frames.
    Distance stays fixed during the orbit, then shrinks geometrically during the push in.
    Geometric (log linear) distance means constant apparent magnification per frame; a
    world space linear dolly would look slow at first and then lurch at the lapel.
    The path ends exactly on the lapel normal, so the weave is square to the sensor."""
    coll = colls["Cameras"]
    lp, ln = rig["lapel_point"], rig["lapel_normal"]
    theta_end = math.atan2(ln.x, -ln.y)
    sweep = math.radians(ORBIT_DEGREES) * ORBIT_DIRECTION
    horiz = math.hypot(ln.x, ln.y)
    orbit_target = Vector((0.0, 0.0, ORBIT_TARGET_Z))

    target = bpy.data.objects.new("CAM_Target_Focus", None)
    target.empty_display_size = 0.05
    coll.objects.link(target)

    edit = bpy.context.preferences.edit
    previous = edit.keyframe_new_interpolation_type
    edit.keyframe_new_interpolation_type = "LINEAR"
    try:
        for f in range(1, FRAME_COUNT + 1):
            target.location = orbit_target.lerp(lp, push_amount(f))
            target.keyframe_insert("location", frame=f)

        for name, v in VARIANTS.items():
            cd = bpy.data.cameras.new(f"CAM_{name}")
            cd.lens = v["lens"]
            cd.sensor_width = 36.0
            cd.sensor_fit = "AUTO"
            cd.clip_start = 0.005       # end distance is under the 0.1 m default
            cd.clip_end = 100.0
            cd.dof.use_dof = True
            cd.dof.focus_object = target
            cd.dof.aperture_blades = 9
            cam = bpy.data.objects.new(f"CAM_{name}", cd)
            coll.objects.link(cam)
            con = cam.constraints.new("TRACK_TO")
            con.target = target
            con.track_axis = "TRACK_NEGATIVE_Z"
            con.up_axis = "UP_Y"        # world up stays vertical: no roll, straight verticals

            for f in range(1, FRAME_COUNT + 1):
                u = (f - 1) / (FRAME_COUNT - 1)
                s = push_amount(f)
                theta = theta_end - sweep * (1.0 - u)
                tgt = orbit_target.lerp(lp, s)
                r = math.exp(lerp(math.log(v["orbit_radius"]),
                                  math.log(v["end_distance"] * horiz), s))
                z = lerp(CAMERA_HEIGHT, lp.z + ln.z * v["end_distance"], s)
                cam.location = (tgt.x + r * math.sin(theta), tgt.y - r * math.cos(theta), z)
                cam.keyframe_insert("location", frame=f)
                # Wide open for the full figure, stopped down at the lapel so the whole
                # weave field is sharp at 7 to 10 cm working distance.
                cd.dof.aperture_fstop = math.exp(lerp(math.log(v["fstop_orbit"]),
                                                      math.log(v["fstop_end"]), s))
                cd.dof.keyframe_insert("aperture_fstop", frame=f)
    finally:
        edit.keyframe_new_interpolation_type = previous
    bpy.context.scene.frame_set(1)


# =============================================================================
# 8. RENDER SETTINGS
# =============================================================================

def detect_gpu():
    addon = bpy.context.preferences.addons.get("cycles")
    if addon is None:
        return None
    prefs = addon.preferences
    for backend in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue                    # backend not compiled into this build or OS
        if hasattr(prefs, "refresh_devices"):
            prefs.refresh_devices()
        else:
            prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == backend]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == backend
            log(f"GPU backend {backend}: {', '.join(d.name for d in gpus)}")
            return backend
    prefs.compute_device_type = "NONE"
    log("no supported GPU found, rendering on CPU")
    return None


def configure_render():
    scene = bpy.context.scene
    r = scene.render
    c = scene.cycles
    r.engine = "CYCLES"
    gpu = detect_gpu()
    c.device = "GPU" if gpu else "CPU"

    c.samples = PREVIEW_SAMPLES if PREVIEW_MODE else FINAL_SAMPLES
    c.use_adaptive_sampling = True
    c.adaptive_threshold = PREVIEW_NOISE_THRESHOLD if PREVIEW_MODE else FINAL_NOISE_THRESHOLD
    c.adaptive_min_samples = 0
    c.seed = NOISE_SEED
    c.use_animated_seed = False

    c.use_denoising = True
    c.denoiser = "OPENIMAGEDENOISE"
    c.denoising_input_passes = "RGB_ALBEDO_NORMAL"
    c.denoising_prefilter = "ACCURATE"
    if hasattr(c, "denoising_quality"):
        c.denoising_quality = "HIGH"
    if hasattr(c, "denoising_use_gpu"):
        c.denoising_use_gpu = bool(gpu)

    c.max_bounces = 8
    c.diffuse_bounces = 4
    c.glossy_bounces = 4
    c.transmission_bounces = 4
    c.transparent_max_bounces = 8
    c.caustics_reflective = False
    c.caustics_refractive = False
    c.blur_glossy = 1.0
    c.sample_clamp_indirect = 8.0

    r.use_motion_blur = False       # scrubbing backwards makes baked blur trail the wrong way
    r.use_persistent_data = True    # static scene: keep BVH and textures between frames
    r.film_transparent = False
    r.fps = 24
    scene.frame_start = 1
    scene.frame_end = FRAME_COUNT

    vs = scene.view_settings
    vs.view_transform = "AgX"
    for look in AGX_LOOKS:
        try:
            vs.look = look
            break
        except TypeError:
            continue
    vs.exposure = 0.0
    vs.gamma = 1.0

    im = r.image_settings
    im.file_format = "PNG"
    im.color_mode = "RGB"
    im.color_depth = PNG_COLOR_DEPTH
    im.compression = 15
    r.use_file_extension = True
    # Resume: Blender skips existing files and writes a placeholder before each frame,
    # so parallel or restarted workers never render the same frame twice.
    r.use_overwrite = not RESUME
    r.use_placeholder = RESUME


def activate_variant(name):
    scene = bpy.context.scene
    v = VARIANTS[name]
    scene.camera = bpy.data.objects[f"CAM_{name}"]
    scene.render.resolution_x, scene.render.resolution_y = v["res"]
    scene.render.resolution_percentage = 25 if PREVIEW_MODE else 100
    out = os.path.join(OUTPUT_DIR, name)
    os.makedirs(out, exist_ok=True)
    scene.render.filepath = os.path.join(out, "frame_####")   # frame_0001.png
    log(f"variant {name}: {v['res'][0]}x{v['res'][1]} at "
        f"{scene.render.resolution_percentage}% -> {out}")


def render_variants():
    scene = bpy.context.scene
    if FRAME_RANGE:
        scene.frame_start, scene.frame_end = FRAME_RANGE
    for name in VARIANTS_TO_RENDER:
        activate_variant(name)
        bpy.ops.render.render(animation=True)
    scene.frame_start, scene.frame_end = 1, FRAME_COUNT


# =============================================================================
# 9. MAIN
# =============================================================================

def parse_cli():
    """Arguments after '--' override the config, for headless and farm use."""
    global PREVIEW_MODE, OUTPUT_DIR, VARIANTS_TO_RENDER, RENDER_ON_RUN, USE_CLOTH_SIM
    global RESUME, FRAME_RANGE, FINAL_SAMPLES, FINAL_NOISE_THRESHOLD, HDRI_PATH
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    p = argparse.ArgumentParser(prog="luxury_suit_scroll.py")
    mode = p.add_mutually_exclusive_group()
    mode.add_argument("--preview", action="store_true")
    mode.add_argument("--final", action="store_true")
    p.add_argument("--output")
    p.add_argument("--variants", nargs="+", choices=sorted(VARIANTS))
    p.add_argument("--no-render", action="store_true")
    p.add_argument("--cloth", action="store_true")
    p.add_argument("--resume", action="store_true", help="skip frames already rendered")
    p.add_argument("--frames", nargs=2, type=int, metavar=("START", "END"))
    p.add_argument("--samples", type=int, help="final sample cap")
    p.add_argument("--noise-threshold", type=float, help="final adaptive threshold")
    p.add_argument("--hdri", help="path to a studio .hdr or .exr")
    a = p.parse_args(argv)
    if a.preview:
        PREVIEW_MODE = True
    if a.final:
        PREVIEW_MODE = False
    if a.output:
        OUTPUT_DIR = a.output
    if a.variants:
        VARIANTS_TO_RENDER = tuple(a.variants)
    if a.no_render:
        RENDER_ON_RUN = False
    if a.cloth:
        USE_CLOTH_SIM = True
    if a.resume:
        RESUME = True
    if a.frames:
        start, end = a.frames
        if not 1 <= start <= end <= FRAME_COUNT:
            p.error(f"--frames must satisfy 1 <= START <= END <= {FRAME_COUNT}")
        FRAME_RANGE = (start, end)
    if a.samples:
        FINAL_SAMPLES = a.samples
    if a.noise_threshold:
        FINAL_NOISE_THRESHOLD = a.noise_threshold
    if a.hdri:
        HDRI_PATH = a.hdri


def main():
    parse_cli()
    if bpy.app.version < (4, 2, 0):
        log(f"warning: built for Blender 4.2+, running {bpy.app.version_string}")
    if not 1 < PUSH_START_FRAME < FRAME_COUNT:
        raise ValueError("PUSH_START_FRAME must fall inside the sequence")

    # Order: clean slate > materials > geometry > cloth (needs geometry, must finish before
    # any keyed frame is evaluated) > room > light > world > camera keys > render settings.
    clear_scene()
    colls = {n: get_collection(n) for n in
             ("Mannequin", "Suit", "Environment", "Lighting", "Cameras")}
    mats = build_materials()
    rig = import_or_placeholder(colls, mats)
    if USE_CLOTH_SIM:
        run_cloth_sim(rig)
    build_environment(colls, mats)
    build_lighting(colls)
    build_world()
    build_camera_animation(colls, rig)
    configure_render()
    activate_variant(VARIANTS_TO_RENDER[0])

    if SAVE_BLEND_PATH:
        bpy.ops.wm.save_as_mainfile(filepath=bpy.path.abspath(SAVE_BLEND_PATH))
    should_render = bpy.app.background if RENDER_ON_RUN is None else RENDER_ON_RUN
    if should_render:
        render_variants()
    log("done" if should_render else "scene built. Render with Ctrl+F12 or run headless.")


if __name__ == "__main__":
    main()
