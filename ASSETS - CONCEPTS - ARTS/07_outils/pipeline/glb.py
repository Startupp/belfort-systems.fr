import json, struct, numpy as np
CT = {5120: 'i1', 5121: 'u1', 5122: '<i2', 5123: '<u2', 5125: '<u4', 5126: '<f4'}; NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
def load(f):
    b = open(f, 'rb').read(); n = struct.unpack('<I', b[12:16])[0]; return json.loads(b[20:20 + n]), b[28 + n:]
def acc(j, B, i):
    a = j['accessors'][i]; bv = j['bufferViews'][a['bufferView']]; dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or dt.itemsize * n
    arr = np.ndarray((a['count'], n), dt, B, off, (st, dt.itemsize)).copy()
    if a.get('normalized'): arr = arr.astype(np.float32) / {5120: 127, 5121: 255, 5122: 32767, 5123: 65535}[a['componentType']]
    return arr
class Out:
    def __init__(s): s.bufs = []; s.acc = []; s.views = []; s.n = 0
    def raw(s, b, target=None):
        s.views.append({'buffer': 0, 'byteOffset': s.n, 'byteLength': len(b), **({'target': target} if target else {})}); b += b'\0' * ((4 - len(b) % 4) % 4); s.bufs.append(b); s.n += len(b); return len(s.views) - 1
    def add(s, arr, typ, comp=5126, target=None, mm=False):
        arr = np.ascontiguousarray(arr.astype(np.dtype(CT[comp]))); v = s.raw(arr.tobytes(), target)
        a = {'bufferView': v, 'componentType': comp, 'count': len(arr), 'type': typ}
        if mm: a['min'] = np.atleast_1d(arr.min(0)).tolist(); a['max'] = np.atleast_1d(arr.max(0)).tolist()
        s.acc.append(a); return len(s.acc) - 1
    def write(s, G, dst):
        B = b''.join(s.bufs); G['accessors'] = s.acc; G['bufferViews'] = s.views; G['buffers'] = [{'byteLength': len(B)}]
        J = json.dumps(G, separators=(',', ':')).encode(); J += b' ' * ((4 - len(J) % 4) % 4)
        open(dst, 'wb').write(struct.pack('<4sII', b'glTF', 2, 28 + len(J) + len(B)) + struct.pack('<I4s', len(J), b'JSON') + J + struct.pack('<I4s', len(B), b'BIN\0') + B)
