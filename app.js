// app.js — Projector Mapping (single-file core)
// Lightweight implementation: Canvas 2D, shapes, vertex drag, triangle-based image mapping, layers

(() => {
  const $ = sel => document.querySelector(sel);
  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  const leftbar = $('#leftbar');
  const rightbar = $('#rightbar');
  const layersEl = $('#layers');
  const selectedInfo = $('#selectedInfo');
  const status = $('#status');

  let DPR = window.devicePixelRatio || 1;
  function resize() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * DPR);
    canvas.height = Math.round(rect.height * DPR);
    ctx.setTransform(DPR,0,0,DPR,0,0);
    render();
  }
  window.addEventListener('resize', resize);

  // App state
  const state = {
    shapes: [],
    tool: 'select',
    selected: null,
    drag: null,
    showGrid: false,
    playing: false
  };

  // Helpers
  function uid(prefix='s'){return prefix+Math.random().toString(36).slice(2,9)}
  function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}

  // Shape factory: rect centered
  function createRect(x,y,w=200,h=150){
    const id = uid('r');
    const points = [[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]];
    return {id,type:'rect',points,opacity:1,visible:true,z:state.shapes.length,rotation:0,scale:1,media:null};
  }

  // Add initial shape
  state.shapes.push(createRect(400,300));

  // UI wiring
  document.querySelectorAll('.tool').forEach(btn=>btn.addEventListener('click',e=>{
    document.querySelectorAll('.tool').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); state.tool = btn.id.replace('tool_','');
    status.textContent = 'Tool: '+state.tool;
  }));

  $('#playBtn').addEventListener('click',()=>{ state.playing=true; playAll(); });
  $('#stopBtn').addEventListener('click',()=>{ state.playing=false; pauseAll(); });
  $('#gridToggle').addEventListener('change',e=>{ state.showGrid = e.target.checked; render(); });
  $('#fullscreenBtn').addEventListener('click',()=>{ document.documentElement.requestFullscreen().then(()=>{document.documentElement.classList.add('hide-cursor');}); });
  $('#exportBtn').addEventListener('click',()=>{ exportJSON(); });
  $('#importBtn').addEventListener('click',()=>{ $('#importFile').click(); });
  $('#importFile').addEventListener('change',ev=>{ const f=ev.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>importJSON(r.result); r.readAsText(f); });

  // Properties
  $('#prop_opacity').addEventListener('input',e=>{ if(state.selected){state.selected.opacity = parseFloat(e.target.value); render(); updateLayersList();}});
  $('#prop_rotation').addEventListener('input',e=>{ if(state.selected){state.selected.rotation = parseFloat(e.target.value); render(); updateLayersList();}});
  $('#prop_scale').addEventListener('input',e=>{ if(state.selected){state.selected.scale = parseFloat(e.target.value); render(); updateLayersList();}});
  $('#btn_toFront').addEventListener('click',()=>{ if(state.selected){bringToFront(state.selected);} });
  $('#btn_toBack').addEventListener('click',()=>{ if(state.selected){sendToBack(state.selected);} });

  function bringToFront(shape){ shape.z = Math.max(...state.shapes.map(s=>s.z))+1; sortZ(); updateLayersList(); render(); }
  function sendToBack(shape){ shape.z = Math.min(...state.shapes.map(s=>s.z))-1; sortZ(); updateLayersList(); render(); }
  function sortZ(){ state.shapes.sort((a,b)=>a.z-b.z); state.shapes.forEach((s,i)=>s.z=i); }

  // Layers list rendering
  function updateLayersList(){ layersEl.innerHTML=''; state.shapes.slice().reverse().forEach(s=>{
    const item = document.createElement('div'); item.className='layer-item';
    item.innerHTML = `<div><input type="checkbox" ${s.visible? 'checked':''} data-id="${s.id}"> ${s.type} ${s.id}</div>`;
    const ctr = document.createElement('div'); ctr.className='layer-controls';
    const up = document.createElement('button'); up.textContent='▲'; const down=document.createElement('button'); down.textContent='▼';
    ctr.appendChild(up); ctr.appendChild(down); item.appendChild(ctr);
    layersEl.appendChild(item);
    item.querySelector('input').addEventListener('change',e=>{ s.visible = e.target.checked; render(); });
    up.addEventListener('click',()=>{ s.z = Math.max(...state.shapes.map(x=>x.z))+1; sortZ(); updateLayersList(); render(); });
    down.addEventListener('click',()=>{ s.z = Math.min(...state.shapes.map(x=>x.z))-1; sortZ(); updateLayersList(); render(); });
    item.addEventListener('click',()=>{ state.selected = s; onSelectShape(s); render(); });
  }); selectedInfo.textContent = state.selected ? `${state.selected.type} ${state.selected.id}` : 'None'; }

  // Selection helper
  function onSelectShape(s){ $('#prop_opacity').value = s.opacity; $('#prop_rotation').value = s.rotation; $('#prop_scale').value = s.scale; }

  // Canvas interactions
  let mouse = {x:0,y:0,down:false};
  function toCanvasCoords(e){ const rect = canvas.getBoundingClientRect(); return {x:(e.clientX - rect.left), y:(e.clientY - rect.top)}; }

  canvas.addEventListener('pointerdown', e=>{
    canvas.setPointerCapture(e.pointerId);
    mouse.down = true; mouse = {...mouse, ...toCanvasCoords(e)};
    // check vertices
    const hit = findVertexNear(mouse,8);
    if(hit){ state.drag = {type:'vertex',shape:hit.shape,vi:hit.vi,offset:{x: mouse.x - hit.pt.x, y: mouse.y - hit.pt.y}}; state.selected = hit.shape; onSelectShape(state.selected); updateLayersList(); render(); return; }
    // check shape hit
    const s = topShapeAt(mouse);
    if(s){ state.selected = s; onSelectShape(s); updateLayersList(); render(); state.drag = {type:'move',shape:s,offset:{x: mouse.x, y: mouse.y}}; }
    else{ state.selected = null; updateLayersList(); render(); }
  });

  canvas.addEventListener('pointermove', e=>{
    mouse = {...mouse, ...toCanvasCoords(e)};
    if(!mouse.down) return;
    if(state.drag){
      if(state.drag.type==='vertex'){
        const s = state.drag.shape; const i = state.drag.vi; s.points[i][0] = mouse.x - state.drag.offset.x; s.points[i][1] = mouse.y - state.drag.offset.y; render(); updateLayersList();
      } else if(state.drag.type==='move'){
        const s = state.drag.shape; const dx = mouse.x - state.drag.offset.x; const dy = mouse.y - state.drag.offset.y; s.points.forEach(p=>{p[0]+=dx; p[1]+=dy}); state.drag.offset.x = mouse.x; state.drag.offset.y = mouse.y; render(); updateLayersList();
      }
    }
  });

  window.addEventListener('pointerup', e=>{ mouse.down=false; state.drag=null; canvas.releasePointerCapture && canvas.releasePointerCapture(e.pointerId); });

  // Keyboard actions (delete vertex)
  window.addEventListener('keydown', e=>{
    if(e.key === 'Delete' || e.key === 'Backspace'){
      if(state.selected && state.selected._selectedVertex!=null){ const vi = state.selected._selectedVertex; state.selected.points.splice(vi,1); state.selected._selectedVertex = null; render(); updateLayersList(); }
    }
  });

  // Vertex utilities
  function findVertexNear(pt,th){ for(let i=state.shapes.length-1;i>=0;i--){ const s = state.shapes[i]; for(let vi=0;vi<s.points.length;vi++){ const p = {x:s.points[vi][0],y:s.points[vi][1]}; if(Math.hypot(p.x-pt.x,p.y-pt.y) <= th) return {shape:s,vi,pt}; }} return null; }
  function topShapeAt(pt){ for(let i=state.shapes.length-1;i>=0;i--){ const s=state.shapes[i]; if(!s.visible) continue; if(pointInPoly(pt, s.points)) return s; } return null; }
  function pointInPoly(pt, poly){ let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const xi=poly[i][0], yi=poly[i][1]; const xj=poly[j][0], yj=poly[j][1]; const intersect = ((yi>pt.y)!=(yj>pt.y)) && (pt.x < (xj-xi)*(pt.y-yi)/(yj-yi)+xi); if(intersect) inside = !inside; } return inside; }

  // Drag & drop files onto canvas -> assign to shape under pointer
  canvas.addEventListener('dragover', e=>{ e.preventDefault(); $('#overlayInfo').style.display='block'; });
  canvas.addEventListener('dragleave', e=>{ $('#overlayInfo').style.display=''; });
  canvas.addEventListener('drop', e=>{
    e.preventDefault(); $('#overlayInfo').style.display=''; const file = e.dataTransfer.files && e.dataTransfer.files[0]; if(!file) return; const pt = toCanvasCoords(e); const s = topShapeAt(pt); if(!s){ status.textContent='Drop onto a shape to assign media'; return; }
    assignFileToShape(file, s);
  });

  // Assign media
  function assignFileToShape(file, shape){ const isVideo = file.type.startsWith('video/'); if(isVideo){ const url = URL.createObjectURL(file); const v = document.createElement('video'); v.src = url; v.loop = true; v.muted = true; v.autoplay = true; v.play(); shape.media = {type:'video',src:url,el:v}; } else { const reader = new FileReader(); reader.onload = ()=>{ const img = new Image(); img.onload = ()=>{ shape.media = {type:'image',src:reader.result,el:img}; render(); }; img.src = reader.result; }; reader.readAsDataURL(file); } render(); updateLayersList(); }

  // Play/pause all videos
  function playAll(){ state.shapes.forEach(s=>{ if(s.media && s.media.type==='video'){ s.media.el.play(); }}); status.textContent='Playing'; }
  function pauseAll(){ state.shapes.forEach(s=>{ if(s.media && s.media.type==='video'){ s.media.el.pause(); }}); status.textContent='Paused'; }

  // Export/import
  function exportJSON(){ const data = JSON.stringify(state.shapes.map(s=>({id:s.id,type:s.type,points:s.points,opacity:s.opacity,visible:s.visible,z:s.z,rotation:s.rotation,scale:s.scale,media: s.media ? {type:s.media.type,src:s.media.type==='image' ? s.media.src : null } : null})),null,2); const blob = new Blob([data], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download='mapping.json'; a.click(); }
  function importJSON(text){ try{ const arr = JSON.parse(text); state.shapes = arr.map(a=>({id:a.id,type:a.type,points:a.points,opacity:a.opacity,visible:a.visible,z:a.z,rotation:a.rotation,scale:a.scale,media:null})); sortZ(); updateLayersList(); render(); status.textContent='Imported'; } catch(e){ status.textContent='Import failed'; } }

  // Rendering core
  function render(){ // clear
    ctx.clearRect(0,0,canvas.width,canvas.height);
    // black background
    ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width,canvas.height);
    if(state.showGrid) drawGrid();
    // draw shapes in z-order
    state.shapes.forEach(s=>{ if(!s.visible) return; ctx.save(); ctx.globalAlpha = s.opacity; // rotation/scale not applied to vertices for simplicity
      // if media: draw by triangulation
      if(s.media && s.media.el){ drawMediaOnShape(s.media.el, s); }
      // outline + vertices
      ctx.strokeStyle = s===state.selected ? 'var(--accent)' : '#444'; ctx.lineWidth=2; ctx.beginPath(); s.points.forEach((p,i)=>{ if(i===0) ctx.moveTo(p[0],p[1]); else ctx.lineTo(p[0],p[1]); }); ctx.closePath(); ctx.stroke();
      // vertices
      s.points.forEach((p,i)=>{ ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(p[0],p[1],6,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#000'; ctx.stroke(); if(s===state.selected){ ctx.fillStyle='var(--accent)'; ctx.beginPath(); ctx.arc(p[0],p[1],3,0,Math.PI*2); ctx.fill(); } });
      ctx.restore(); });
  }

  function drawGrid(){ const step=50; ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1; for(let x=0;x<canvas.width;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); } for(let y=0;y<canvas.height;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); } ctx.restore(); }

  // Draw media by triangulating polygon into triangles and mapping image/video onto each triangle
  function drawMediaOnShape(mediaEl, shape){ const pts = shape.points.map(p=>({x:p[0],y:p[1]})); const imgW = mediaEl.videoWidth || mediaEl.width || 1; const imgH = mediaEl.videoHeight || mediaEl.height || 1;
    // triangulate using fan from 0
    for(let i=1;i<pts.length-1;i++){
      // source triangles: split image into two triangles to cover rectangle
      // We map whole image to polygon using two triangles from image coords
      const sx0=0, sy0=0, sx1=imgW, sy1=0, sx2=0, sy2=imgH;
      const dx0=pts[0].x, dy0=pts[0].y, dx1=pts[i].x, dy1=pts[i].y, dx2=pts[i+1].x, dy2=pts[i+1].y;
      drawImageTriangle(mediaEl, sx0,sy0,sx1,sy1,sx2,sy2, dx0,dy0,dx1,dy1,dx2,dy2);
      // second triangle to cover remaining area (using another src triangle)
      const sx3 = imgW, sy3 = imgH;
      drawImageTriangle(mediaEl, sx1,sy1,sx3,sy3,sx2,sy2, dx1,dy1,dx2,dy2,dx0,dy0);
    }
  }

  // Draw source triangle -> destination triangle using affine transform
  // We compute affine transform matrix that maps src triangle points to dst points.
  function drawImageTriangle(img, sx0,sy0,sx1,sy1,sx2,sy2, dx0,dy0,dx1,dy1,dx2,dy2){ ctx.save();
    // Build 3x3 source matrix S and invert it
    const S = [ [sx0, sy0, 1],[sx1, sy1, 1],[sx2, sy2,1] ];
    const Dx = [dx0,dx1,dx2];
    const Dy = [dy0,dy1,dy2];
    const invS = invert3(S);
    if(!invS){ ctx.restore(); return; }
    // Xcoeff = invS * Dx
    const a = invS[0][0]*Dx[0] + invS[0][1]*Dx[1] + invS[0][2]*Dx[2];
    const c = invS[1][0]*Dx[0] + invS[1][1]*Dx[1] + invS[1][2]*Dx[2];
    const e = invS[2][0]*Dx[0] + invS[2][1]*Dx[1] + invS[2][2]*Dx[2];
    const b = invS[0][0]*Dy[0] + invS[0][1]*Dy[1] + invS[0][2]*Dy[2];
    const d = invS[1][0]*Dy[0] + invS[1][1]*Dy[1] + invS[1][2]*Dy[2];
    const f = invS[2][0]*Dy[0] + invS[2][1]*Dy[1] + invS[2][2]*Dy[2];
    // clip to destination triangle
    ctx.beginPath(); ctx.moveTo(dx0,dy0); ctx.lineTo(dx1,dy1); ctx.lineTo(dx2,dy2); ctx.closePath(); ctx.clip();
    // set transform so that when we draw the source image at (0,0) it maps correctly
    ctx.setTransform(a,b,c,d,e,f);
    // draw image
    try{ ctx.drawImage(img, 0, 0); } catch(e) {}
    ctx.restore();
  }

  // Invert 3x3 matrix (array of rows)
  function invert3(m){ const a=m[0][0], b=m[0][1], c=m[0][2], d=m[1][0], e=m[1][1], f=m[1][2], g=m[2][0], h=m[2][1], i=m[2][2];
    const A = e*i - f*h; const B = -(d*i - f*g); const C = d*h - e*g;
    const D = -(b*i - c*h); const E = a*i - c*g; const F = -(a*h - b*g);
    const G = b*f - c*e; const H = -(a*f - c*d); const I = a*e - b*d;
    const det = a*A + b*B + c*C;
    if(Math.abs(det) < 1e-9) return null;
    const invDet = 1/det;
    return [ [A*invDet, D*invDet, G*invDet], [B*invDet, E*invDet, H*invDet], [C*invDet, F*invDet, I*invDet] ];
  }

  // Initial render and resizes
  function init(){ resize(); updateLayersList(); render(); }
  window.addEventListener('load', init);

  // Expose some utilities for debugging
  window._PM = { state, render, assignFileToShape };

  // small convenience: allow creating new rect on leftbar click
  $('#tool_rect').addEventListener('click',()=>{ state.shapes.push(createRect(400+Math.random()*100,200+Math.random()*100)); sortZ(); updateLayersList(); render(); });

})();
