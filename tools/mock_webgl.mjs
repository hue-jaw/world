// ============================================================================
// METROPOLIS — tools/mock_webgl.mjs
// Faux contexte WebGL 2 assez complet pour que three.js compile ses shaders et
// parcoure TOUT le chemin de rendu (programmes, uniformes, shadow maps, PMREM)
// sans GPU ni navigateur.
//
// Pourquoi c'est indispensable : les tests construisaient la ville et
// appelaient `onBeforeCompile()` à la main, mais jamais `customProgramCacheKey()`
// ni `renderer.render()`. Le crash v0.4 « Cannot read properties of undefined
// (reading 'onBeforeCompile') » venait de `Material.customProgramCacheKey` de
// three.js (`this.onBeforeCompile`) appelée détachée : `this === undefined`.
// Invisible pour les anciens tests, fatal au premier rendu. Ce faux contexte
// comble ce trou.
//
// Il ne dessine rien : il dit seulement si le chemin de rendu lève une erreur.
// ============================================================================
export function makeGL(width = 1280, height = 720) {
  const ids = new Map();
  let id = 1;
  const obj = (kind) => { const o = { __kind: kind, __id: id++ }; return o; };
  const consts = {};
  const rev = new Map();
  let c = 1;
  const C = (name) => {
    if (!(name in consts)) { consts[name] = c++; rev.set(consts[name], name); }
    return consts[name];
  };
  const PARAMS = {
    VERSION: 'WebGL 2.0 (mock)', SHADING_LANGUAGE_VERSION: 'WebGL GLSL ES 3.00 (mock)',
    VENDOR: 'mock', RENDERER: 'mock',
    MAX_TEXTURE_SIZE: 8192, MAX_CUBE_MAP_TEXTURE_SIZE: 8192, MAX_3D_TEXTURE_SIZE: 2048,
    MAX_ARRAY_TEXTURE_LAYERS: 2048,
    MAX_VERTEX_ATTRIBS: 16, MAX_VERTEX_UNIFORM_VECTORS: 1024, MAX_VARYING_VECTORS: 30,
    MAX_FRAGMENT_UNIFORM_VECTORS: 1024,
    MAX_VERTEX_TEXTURE_IMAGE_UNITS: 16, MAX_TEXTURE_IMAGE_UNITS: 16,
    MAX_COMBINED_TEXTURE_IMAGE_UNITS: 32,
    MAX_DRAW_BUFFERS: 8, MAX_COLOR_ATTACHMENTS: 8, MAX_SAMPLES: 4,
    MAX_TEXTURE_MAX_ANISOTROPY_EXT: 16,
    MAX_CLIENT_WAIT_TIMEOUT_WEBGL: 0,
  };
  const base = {
    getContextAttributes: () => ({ alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'default' }),
    // Allowlist explicite : renvoyer {} à TOUTE extension faisait croire à
    // three.js que WEBGL_multisampled_render_to_texture existait, et il
    // appelait framebufferTexture2DMultisampleEXT (absent du mock) dès qu'un
    // render target MSAA (post-traitement) était créé. En navigateur, une
    // extension non supportée renvoie null — le mock doit faire pareil.
    getExtension: (n) => (n === 'WEBGL_debug_renderer_info'
      ? { UNMASKED_RENDERER_WEBGL: 1, UNMASKED_VENDOR_WEBGL: 2 }
      : (n === 'EXT_color_buffer_float' || n === 'OES_texture_float_linear'
        || n === 'EXT_texture_filter_anisotropic') ? {} : null),
    getSupportedExtensions: () => ['EXT_color_buffer_float', 'OES_texture_float_linear'],
    getParameter: (p) => {
      const nm = rev.get(p);
      if (nm && nm in PARAMS) return PARAMS[nm];
      if (nm === 'VIEWPORT' || nm === 'SCISSOR_BOX') return new Int32Array([0, 0, width, height]);
      if (nm === 'COLOR_CLEAR_VALUE') return new Float32Array([0, 0, 0, 0]);
      if (nm && nm.startsWith('MAX_')) return 16;
      switch (p) {
        case 7938: return 'WebGL 2.0 (mock)';            // VERSION
        case 35724: return 'WebGL GLSL ES 3.00 (mock)';  // SHADING_LANGUAGE_VERSION
        case 7936: case 7937: return 'mock';
        case 34921: return 16;   // MAX_VERTEX_ATTRIBS
        case 35660: return 16;   // MAX_VERTEX_TEXTURE_IMAGE_UNITS
        case 34930: return 16;   // MAX_TEXTURE_IMAGE_UNITS
        case 35661: return 32;   // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        case 36347: return 1024; // MAX_VERTEX_UNIFORM_VECTORS
        case 36348: return 1024;
        case 36349: return 1024; // MAX_FRAGMENT_UNIFORM_VECTORS
        case 3379: case 34076: case 34024: return 8192; // MAX_TEXTURE_SIZE etc.
        case 34852: return 8;    // MAX_DRAW_BUFFERS
        case 36063: return 8;    // MAX_COLOR_ATTACHMENTS
        case 32883: return 2048; // MAX_3D_TEXTURE_SIZE
        case 35071: return 2048;
        case 35658: return 1024;
        case 35659: return 1024;
        case 35375: return 1024;
        case 35376: return 1024;
        case 35377: return 64;
        case 35379: return 4;
        case 35380: return 4;
        case 34047: return 16;   // MAX_TEXTURE_MAX_ANISOTROPY_EXT
        case 36183: return 4;
        case 3386: return new Int32Array([8192, 8192]);
        case 2978: return new Int32Array([0, 0, width, height]);
        default: return 0;
      }
    },
    getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 }),
    getShaderParameter: () => true,
    getProgramParameter: (_prog, p) => {
      const nm = rev.get(p) || '';
      if (nm.startsWith('ACTIVE_')) return 0;
      if (nm === 'DELETE_STATUS' || nm === 'LINK_STATUS' || nm === 'VALIDATE_STATUS') return true;
      if (nm === 'COMPLETION_STATUS_KHR') return true;
      return 0;
    },
    getShaderParameter: (_s, p) => {
      const nm = rev.get(p) || '';
      return nm === 'COMPILE_STATUS' || nm === 'DELETE_STATUS' ? true : 0;
    },
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getError: () => 0,
    isContextLost: () => false,
    getUniformLocation: () => obj('uniform'),
    getAttribLocation: () => 0,
    getActiveUniform: () => null,
    getActiveAttrib: () => null,
    createShader: () => obj('shader'),
    createProgram: () => obj('program'),
    createBuffer: () => obj('buffer'),
    createTexture: () => obj('tex'),
    createFramebuffer: () => obj('fbo'),
    createRenderbuffer: () => obj('rbo'),
    renderbufferStorageMultisample: () => undefined,
    blitFramebuffer: () => undefined,
    createVertexArray: () => obj('vao'),
    createQuery: () => obj('query'),
    createSampler: () => obj('sampler'),
    createTransformFeedback: () => obj('tf'),
    fenceSync: () => obj('sync'),
    checkFramebufferStatus: () => 36053, // FRAMEBUFFER_COMPLETE
    getSyncParameter: () => 37146,
  };
  return new Proxy(base, {
    get(t, p) {
      if (p in t) return t[p];
      if (typeof p === 'string' && /^[A-Z0-9_]+$/.test(p)) return C(p);
      return () => undefined;
    },
  });
}
