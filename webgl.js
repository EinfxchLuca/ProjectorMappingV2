// webgl.js — Three.js-based GPU mapping layer
// Syncs shapes from window._PM.state into textured meshes for perspective-correct mapping

(function(){
  const THREE_CDN = 'https://unpkg.com/three@0.152.2/build/three.min.js';
  function loadScript(src, cb){ const s=document.createElement('script'); s.src=src; s.onload=cb; s.onerror=cb; document.head.appendChild(s); }

  loadScript(THREE_CDN, init);

  function init(){
    if(typeof THREE === 'undefined'){ console.warn('Three.js failed to load'); return; }
    const canvas = document.getElementById('webgl');
    const renderer = new THREE.WebGLRenderer({canvas:canvas, alpha:true, antialias:true});
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    const scene = new THREE.Scene();
    // Orthographic camera matching DOM pixel coordinates (top-left origin)
    let cam;
    function makeCamera(w,h){ cam = new THREE.OrthographicCamera(0, w, h, 0, -1000, 1000); cam.position.z = 1; }

    let meshes = new Map(); // shapeId -> {mesh, tex}

    function resize(){
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      renderer.setSize(w,h,false);
      if(!cam) makeCamera(w,h); else { cam.left = 0; cam.right = w; cam.top = h; cam.bottom = 0; cam.updateProjectionMatrix(); }
      // position canvas to match #stage
      canvas.style.position = 'absolute'; canvas.style.left = rect.left + 'px'; canvas.style.top = rect.top + 'px'; canvas.style.width = rect.width+'px'; canvas.style.height = rect.height+'px'; canvas.style.zIndex = 0; // behind the UI canvas (#stage has higher stacking context)
    }
    window.addEventListener('resize', resize);

    function createTextureForShape(s){ if(!s.media) return null; try{
        if(s.media.type==='video' && s.media.el){ const vt = new THREE.VideoTexture(s.media.el); vt.minFilter = THREE.LinearFilter; vt.magFilter = THREE.LinearFilter; vt.format = THREE.RGBFormat; return vt; }
        if(s.media.type==='image' && s.media.el){ const tex = new THREE.Texture(s.media.el); tex.needsUpdate = true; return tex; }
      } catch(e){ console.warn('texture create failed', e); } return null; }

    function buildMeshForShape(s){ // return a THREE.Mesh or null
      if(!s.media) return null;
      const pts = s.vertices.map(p=> new THREE.Vector2(p[0], p[1]));
      // For quads (4 verts) and triangles (3 verts) create indexed BufferGeometry with proper UVs for perspective-correct mapping
      if(s.vertices.length===4){ // quad -> two triangles
        const geometry = new THREE.BufferGeometry();
        // positions (x,y,z)
        const positions = new Float32Array([ pts[0].x, pts[0].y,0, pts[1].x,pts[1].y,0, pts[2].x,pts[2].y,0, pts[3].x,pts[3].y,0 ]);
        const indices = new Uint16Array([0,1,2, 0,2,3]);
        // UVs map whole image to quad corners
        const uvs = new Float32Array([0,0, 1,0, 1,1, 0,1]);
        geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
        geometry.setAttribute('uv', new THREE.BufferAttribute(uvs,2));
        geometry.setIndex(new THREE.BufferAttribute(indices,1));
        geometry.computeVertexNormals();
        return geometry;
      }
      if(s.vertices.length===3){ const geometry = new THREE.BufferGeometry(); const positions = new Float32Array([ pts[0].x,pts[0].y,0, pts[1].x,pts[1].y,0, pts[2].x,pts[2].y,0 ]); const indices = new Uint16Array([0,1,2]); const uvs = new Float32Array([0,0, 1,0, 0,1]); geometry.setAttribute('position', new THREE.BufferAttribute(positions,3)); geometry.setAttribute('uv', new THREE.BufferAttribute(uvs,2)); geometry.setIndex(new THREE.BufferAttribute(indices,1)); geometry.computeVertexNormals(); return geometry; }
      // For other polygons fall back to ShapeGeometry (texture will be mapped to bounding box)
      const shape = new THREE.Shape(pts);
      const geometry = new THREE.ShapeGeometry(shape);
      // UVs from ShapeGeometry are generated but normally correspond to local coords; that's acceptable fallback
      return geometry;
    }

    function sync(){
      const pm = window._PM;
      if(!pm || !pm.state) return;
      const shapes = pm.state.shapes || [];
      const existingIds = new Set(meshes.keys());
      shapes.forEach((s, idx)=>{
        existingIds.delete(s.id);
        // only create mesh for shapes with media
        if(!s.media) {
          if(meshes.has(s.id)){ const rec = meshes.get(s.id); scene.remove(rec.mesh); disposeRec(rec); meshes.delete(s.id); }
          return;
        }
        let rec = meshes.get(s.id);
        const texChanged = !rec || (rec.src !== (s.media.src||null));
        if(!rec || texChanged){ // (re)create
          if(rec){ scene.remove(rec.mesh); disposeRec(rec); meshes.delete(s.id); }
          const geom = buildMeshForShape(s);
          if(!geom) return;
          const tex = createTextureForShape(s);
          const mat = new THREE.MeshBasicMaterial({map: tex, transparent: true, opacity: s.opacity, side: THREE.DoubleSide});
          const mesh = new THREE.Mesh(geom, mat);
          mesh.renderOrder = s.layerIndex || 0;
          scene.add(mesh);
          meshes.set(s.id, {mesh, tex, mat, src: s.media.src});
        } else {
          // update geometry positions if vertex changed
          const rec2 = meshes.get(s.id);
          const geom = rec2.mesh.geometry;
          // attempt to update positions attribute if length matches
          const posAttr = geom.getAttribute('position');
          if(posAttr && posAttr.count === s.vertices.length){
            for(let i=0;i<s.vertices.length;i++){ posAttr.setXYZ(i, s.vertices[i][0], s.vertices[i][1], 0); }
            posAttr.needsUpdate = true;
          } else {
            // rebuild
            scene.remove(rec2.mesh); disposeRec(rec2); meshes.delete(s.id);
            const newG = buildMeshForShape(s); const tex = rec2.tex; const mat = new THREE.MeshBasicMaterial({map: tex, transparent:true, opacity:s.opacity, side:THREE.DoubleSide}); const mesh = new THREE.Mesh(newG, mat); scene.add(mesh); meshes.set(s.id, {mesh, tex, mat, src: s.media.src});
          }
          // update material opacity and renderOrder
          rec2.mat.opacity = s.opacity;
          rec2.mesh.renderOrder = s.layerIndex || 0;
        }
      });
      // remove deleted meshes
      existingIds.forEach(id=>{ const rec = meshes.get(id); if(rec){ scene.remove(rec.mesh); disposeRec(rec); meshes.delete(id); } });
    }

    function disposeRec(r){ try{ if(r.tex && r.tex.dispose) r.tex.dispose(); if(r.mat) r.mat.dispose(); if(r.mesh && r.mesh.geometry) r.mesh.geometry.dispose(); }catch(e){} }

    function animate(){ requestAnimationFrame(animate); resize(); sync(); renderer.render(scene, cam); }
    animate();
  }

})();
