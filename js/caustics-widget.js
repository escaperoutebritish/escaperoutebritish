// caustics-widget.js
// Loosely based on Caustics from @XorDev on X
// Host this file and reference it from your page with a <script src="..."></script> tag.
// It expects React and ReactDOM to already be loaded (the HTML snippet above does that).

(function () {
  // Wait until DOM and React are available
  function ready(fn) {
    if (document.readyState !== 'loading') return fn();
    document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    // Ensure React is available
    if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
      console.warn('React or ReactDOM not found. Make sure you included the CDN scripts.');
      return;
    }

    // Create a small React wrapper that will contain the canvas
    const rootEl = document.getElementById('react-root') || (function () {
      const d = document.createElement('div');
      d.id = 'react-root';
      document.body.insertBefore(d, document.body.firstChild);
      return d;
    })();

    // Render a container div via React so RocketCake pages that expect React elements are satisfied
    const App = function () {
      return React.createElement('div', {
        id: 'caustics-container',
        style: 'position:fixed;inset:0;width:100%;height:100%;z-index:-1;pointer-events:none;'
      });
    };

    const root = ReactDOM.createRoot(rootEl);
    root.render(React.createElement(App));

    // Now create the canvas and append it inside the container
    const container = document.getElementById('caustics-container');
    if (!container) {
      console.warn('Caustics container not found.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.id = 'caustics-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.zIndex = '-1';
    container.appendChild(canvas);

    // ---------- WebGL caustics code (finite-difference fallback) ----------
    const gl = canvas.getContext('webgl', { antialias: true });
    if (!gl) {
      console.warn('WebGL not supported in this browser.');
      return;
    }

    const vsSource = `
      attribute vec2 aPosition;
      varying vec2 vUv;
      void main() {
        vUv = aPosition * 0.5 + 0.5;
        gl_Position = vec4(aPosition, 0.0, 1.0);
      }`;

    const fsSource = `
      precision mediump float;
      varying vec2 vUv;
      uniform float uTime;
      uniform vec2 uResolution;
      uniform sampler2D uTexture;
      uniform int uUseTexture;
      uniform int uMapping; // 0 stretch, 1 cover, 2 tile
      uniform float uSpeed;
      uniform float uIntensity;
      uniform float uLoopCount;

      float tanh_approx(float x){
        float e = exp(2.0 * x);
        return (e - 1.0) / (e + 1.0);
      }

      vec2 mapUV(vec2 uv, vec2 res, int mode) {
        if(mode == 2) {
          float aspect = res.x / res.y;
          return vec2(uv.x * aspect, uv.y);
        } else if(mode == 1) {
          float screenAR = res.x / res.y;
          float imgAR = 1.0;
          if(screenAR > imgAR) {
            float scale = screenAR / imgAR;
            return vec2(uv.x, (uv.y - 0.5) * scale + 0.5);
          } else {
            float scale = imgAR / screenAR;
            return vec2((uv.x - 0.5) * scale + 0.5, uv.y);
          }
        } else {
          return uv;
        }
      }

      void main(){
        vec2 FC = vUv;
        vec2 r = vec2(uResolution.x / uResolution.y, 1.0);
        float t = uTime * 0.2 * uSpeed;
        vec2 p = FC.xy / r.y * 20.0 + t;

        float maxI = min(uLoopCount, 12.0);
        for(float i = 0.0; i < 12.0; i += 1.0){
          if(i >= maxI) break;
          p += sin(p + t * 5.0 + i) * 0.4;
          p *= mat2(6.0, -8.0, 8.0, 6.0) / 9.0;
        }

        vec2 px = vec2(1.0 / uResolution.x, 0.0);
        vec2 py = vec2(0.0, 1.0 / uResolution.y);

        vec2 s  = sin(p * 0.3) / 0.1;

        vec2 p_x = p + px * 20.0;
        vec2 p_y = p + py * 20.0;

        p_x += sin(p_x + t * 5.0) * 0.4;
        p_x *= mat2(6.0, -8.0, 8.0, 6.0) / 9.0;
        p_y += sin(p_y + t * 5.0) * 0.4;
        p_y *= mat2(6.0, -8.0, 8.0, 6.0) / 9.0;

        vec2 sx = sin(p_x * 0.3) / 0.1;
        vec2 sy = sin(p_y * 0.3) / 0.1;

        float dx = length(sx - s);
        float dy = length(sy - s);
        float detail = sqrt(dx*dx + dy*dy) * uIntensity;

        float v = tanh_approx(detail);
        float bright = 1.0 - v;

        vec3 base = vec3(0.02, 0.05, 0.12);
        vec3 texColor = vec3(0.0);

        if(uUseTexture == 1) {
          vec2 mappedUV = mapUV(FC, uResolution, uMapping);
          if(uMapping == 2) mappedUV = fract(mappedUV);
          texColor = texture2D(uTexture, mappedUV).rgb;
          texColor = pow(texColor, vec3(2.2));
        }

        vec3 multiply = texColor * (mix(vec3(1.0 - 0.6*bright), vec3(1.0), bright));
        vec3 add = texColor + vec3(bright * 0.8);

        vec3 color = base;
        if(uUseTexture == 1) color = mix(multiply, add, 0.25);
        else color = mix(base, vec3(1.0), bright);

        color = pow(color, vec3(1.0 / 2.2));
        gl_FragColor = vec4(color, 1.0);
      }`;

    function createShader(gl, type, source) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error('Shader compile error:', gl.getShaderInfoLog(s));
        console.error(source);
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    function createProgram(gl, vsSrc, fsSrc) {
      const vs = createShader(gl, gl.VERTEX_SHADER, vsSrc);
      const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(prog));
        gl.deleteProgram(prog);
        return null;
      }
      return prog;
    }

    // compile program
    const program = createProgram(gl, vsSource, fsSource);
    if (!program) {
      gl.clearColor(0.02, 0.05, 0.12, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }

    // quad
    const quad = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPosition = gl.getAttribLocation(program, 'aPosition');
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    // uniforms
    const uTime = gl.getUniformLocation(program, 'uTime');
    const uResolution = gl.getUniformLocation(program, 'uResolution');
    const uTexture = gl.getUniformLocation(program, 'uTexture');
    const uUseTexture = gl.getUniformLocation(program, 'uUseTexture');
    const uMapping = gl.getUniformLocation(program, 'uMapping');
    const uSpeed = gl.getUniformLocation(program, 'uSpeed');
    const uIntensity = gl.getUniformLocation(program, 'uIntensity');
    const uLoopCount = gl.getUniformLocation(program, 'uLoopCount');

    // default settings (you can change these)
    let imageUrl = null; // set to a URL string to enable texture
    let mappingMode = 0; // 0 stretch, 1 cover, 2 tile
    let speed = 1.0;
    let intensity = 1.0;
    let loopCount = 8;

    // If you want to enable an image, set imageUrl here or later via window._caustics.setImage(url)
    // Example: imageUrl = 'https://example.com/pool.jpg';

    let texture = null;
    let useTexture = 0;

    function loadTexture(url) {
      if (!url) return;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        if ((img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0) {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        } else {
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        useTexture = 1;
      };
      img.onerror = function () {
        console.warn('Caustics: image failed to load', url);
      };
      img.src = url;
    }

    // Expose a small runtime API so you can change settings from the console or other scripts
    window._caustics = {
      setImage: function (url) { imageUrl = url; loadTexture(url); },
      setMapping: function (m) { mappingMode = m | 0; },
      setSpeed: function (s) { speed = Number(s) || 1.0; },
      setIntensity: function (v) { intensity = Number(v) || 1.0; },
      setLoopCount: function (n) { loopCount = Math.max(1, Math.min(12, Number(n) || 8)); }
    };

    // If you set imageUrl above, start loading now
    if (imageUrl) loadTexture(imageUrl);

    // resize
    function resize() {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.floor(canvas.clientWidth * dpr);
      const h = Math.floor(canvas.clientHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    }
    window.addEventListener('resize', resize);
    resize();

    // render loop
    let start = performance.now();
    function render(now) {
      resize();
      const t = (now - start) * 0.001;

      gl.useProgram(program);
      gl.uniform1f(uTime, t);
      gl.uniform2f(uResolution, canvas.width, canvas.height);
      gl.uniform1i(uUseTexture, useTexture);
      gl.uniform1i(uMapping, mappingMode);
      gl.uniform1f(uSpeed, speed);
      gl.uniform1f(uIntensity, intensity);
      gl.uniform1f(uLoopCount, Math.max(1, Math.min(12, loopCount)));

      if (useTexture && texture) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uTexture, 0);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
  });
})();
