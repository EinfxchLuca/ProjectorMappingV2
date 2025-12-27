// app.js — Refactored Projector Mapping core
// Goals: clean shape state, single render loop, working tools (rect/poly/triangle/circle),
// media assigned once per shape, live properties, delete/edit functionality.

(function(){
  const $ = s => document.querySelector(s);
  const canvas = $('#stage');
  const ctx = canvas.getContext('2d');
  const layersEl = $('#layers');
  const status = $('#status');
  const selectedInfo = $('#selectedInfo');

  let DPR = window.devicePixelRatio || 1;
  function resize(){
    const r = canvas.getBoundingClientRect();
    canvas.width = Math.round(r.width * DPR);
    canvas.height = Math.round(r.height * DPR);
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    ctx.setTransform(DPR,0,0,DPR,0,0);
  }
  window.addEventListener('resize', resize);

  // Centralized shape state
  const state = {
    shapes: [], // ordered by layerIndex
    currentTool: 'select',
    selectedShapeId: null,
    selectedVertex: null, // {shapeId,vi}
    dragging: null,
    showGrid: false,
    creating: null, // temp shape when creating polygon/triangle/circle
  };

  function uid(pref='s'){ return pref + Math.random().toString(36).slice(2,9); }

  // Shape structure helper
  function makeShape(type, verts, opts={}){
    return Object.assign({
      id: uid(type[0]),
      type, // rect, polygon, triangle, circle
      vertices: verts, // array of [x,y]
      media: null, // {type,src,el}
      opacity: 1,
      rotation: 0, // degrees
      scale: 1,
      layerIndex: state.shapes.length,
      visible: true
    }, opts);
  }

  // Add initial sample rect (center area)
  function addInitial(){
    const w=240,h=160,x=420,y=260;
    const rect = makeShape('rect', [[x-w/2,y-h/2],[x+w/2,y-h/2],[x+w/2,y+h/2],[x-w/2,y+h/2]]);
    state.shapes.push(rect);
  }
  addInitial();

  // UI wiring - tools
  function setActiveTool(tool){ state.currentTool = tool; document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active', b.id==='tool_'+tool)); status.textContent = 'Tool: '+tool; }
  document.querySelectorAll('.tool').forEach(b=> b.addEventListener('click', ()=> setActiveTool(b.id.replace('tool_',''))));
  setActiveTool('select');

  $('#playBtn').addEventListener('click', ()=>{ playAll(); state.playing=true; });
  $('#stopBtn').addEventListener('click', ()=>{ pauseAll(); state.playing=false; });
  $('#gridToggle').addEventListener('change', e=>{ state.showGrid = e.target.checked; render(); });
  $('#fullscreenBtn').addEventListener('click', ()=>{ document.documentElement.requestFullscreen().then(()=>document.documentElement.classList.add('hide-cursor')); });
  $('#exportBtn').addEventListener('click', exportJSON);
  $('#importBtn').addEventListener('click', ()=>$('#importFile').click());
  $('#importFile').addEventListener('change', ev=>{ const f=ev.target.files[0]; if(!f) return; const r=new FileReader(); r.onload=()=>importJSON(r.result); r.readAsText(f); });

  // Edit buttons
  // Delete shape button (add to leftbar dynamically)
  const delBtn = document.createElement('button'); delBtn.textContent = 'Delete Shape'; delBtn.addEventListener('click', ()=>{ if(state.selectedShapeId) { deleteShapeById(state.selectedShapeId); } });
  document.getElementById('leftbar').appendChild(document.createElement('hr'));
  document.getElementById('leftbar').appendChild(delBtn);

  // Properties binding
  $('#prop_opacity').addEventListener('input', e=>{ const s = getSelectedShape(); if(s){ s.opacity = parseFloat(e.target.value); render(); updateLayersList(); }});
  $('#prop_rotation').addEventListener('input', e=>{ const s = getSelectedShape(); if(s){ s.rotation = parseFloat(e.target.value); render(); updateLayersList(); }});
  $('#prop_scale').addEventListener('input', e=>{ const s = getSelectedShape(); if(s){ s.scale = parseFloat(e.target.value); render(); updateLayersList(); }});
  $('#btn_toFront').addEventListener('click', ()=>{ if(state.selectedShapeId) bringToFront(state.selectedShapeId); });
  $('#btn_toBack').addEventListener('click', ()=>{ if(state.selectedShapeId) sendToBack(state.selectedShapeId); });

  function bringToFront(id){ const s = findById(id); if(!s) return; s.layerIndex = Math.max(...state.shapes.map(x=>x.layerIndex))+1; normalizeLayers(); updateLayersList(); render(); }
  function sendToBack(id){ const s = findById(id); if(!s) return; s.layerIndex = Math.min(...state.shapes.map(x=>x.layerIndex))-1; normalizeLayers(); updateLayersList(); render(); }
  function normalizeLayers(){ state.shapes.sort((a,b)=>a.layerIndex-b.layerIndex); state.shapes.forEach((s,i)=>s.layerIndex=i); }

  function findById(id){ return state.shapes.find(s=>s.id===id); }
  function getSelectedShape(){ return state.selectedShapeId ? findById(state.selectedShapeId) : null; }

  // Layers panel
  function updateLayersList(){ layersEl.innerHTML=''; state.shapes.slice().reverse().forEach(s=>{
    const item = document.createElement('div'); item.className='layer-item';
    item.innerHTML = `<div><input type="checkbox" ${s.visible? 'checked':''} data-id="${s.id}"> ${s.type} ${s.id}</div>`;
    const ctr = document.createElement('div'); ctr.className='layer-controls';
    const up = document.createElement('button'); up.textContent='▲'; const down=document.createElement('button'); down.textContent='▼';
    ctr.appendChild(up); ctr.appendChild(down); item.appendChild(ctr);
    layersEl.appendChild(item);
    item.querySelector('input').addEventListener('change', e=>{ s.visible = e.target.checked; render(); });
    up.addEventListener('click', ()=>{ s.layerIndex = Math.max(...state.shapes.map(x=>x.layerIndex))+1; normalizeLayers(); updateLayersList(); render(); });
    down.addEventListener('click', ()=>{ s.layerIndex = Math.min(...state.shapes.map(x=>x.layerIndex))-1; normalizeLayers(); updateLayersList(); render(); });
    item.addEventListener('click', ()=>{ state.selectedShapeId = s.id; state.selectedVertex = null; syncPropsToUI(); render(); });
  });
  syncPropsToUI();
  }

  function syncPropsToUI(){ const s = getSelectedShape(); selectedInfo.textContent = s ? `${s.type} ${s.id}` : 'None'; if(s){ $('#prop_opacity').value = s.opacity; $('#prop_rotation').value = s.rotation; $('#prop_scale').value = s.scale; } }

  // Canvas coordinate helpers
  function canvasPoint(e){ const r = canvas.getBoundingClientRect(); return {x: (e.clientX - r.left), y: (e.clientY - r.top)}; }

  // Geometry helpers
  function centroid(vertices){ let x=0,y=0; vertices.forEach(p=>{x+=p[0]; y+=p[1];}); return {x:x/vertices.length, y:y/vertices.length}; }
  function toLocalPoint(pt, shape){ const c = centroid(shape.vertices); const angle = -shape.rotation * Math.PI/180; const s = 1/shape.scale; const dx = pt.x - c.x; const dy = pt.y - c.y; const lx = (dx * Math.cos(angle) - dy * Math.sin(angle)) * s; const ly = (dx * Math.sin(angle) + dy * Math.cos(angle)) * s; return {x: lx, y: ly, cx: c.x, cy: c.y}; }
  function fromLocal(lx, ly, shape, cx, cy){ const angle = shape.rotation * Math.PI/180; const sx = lx * shape.scale; const sy = ly * shape.scale; const x = sx * Math.cos(angle) - sy * Math.sin(angle) + cx; const y = sx * Math.sin(angle) + sy * Math.cos(angle) + cy; return {x,y}; }

  // Hit testing with transforms
  function findVertexNear(pt, thresh=8){ for(let i=state.shapes.length-1;i>=0;i--){ const s = state.shapes[i]; if(!s.visible) continue; const c = centroid(s.vertices); // compute local coordinates
    const local = toLocalPoint(pt, s);
    for(let vi=0; vi<s.vertices.length; vi++){ const v = s.vertices[vi]; const lx = v[0]-c.x, ly = v[1]-c.y; const dx = local.x - lx, dy = local.y - ly; if(Math.hypot(dx,dy) <= thresh) return {shape:s,vi,localX:lx,localY:ly,centroid:c}; }
  } return null; }

  function pointInPolyTransformed(pt, s){ const c = centroid(s.vertices); const local = toLocalPoint(pt, s); const localVerts = s.vertices.map(v=>[v[0]-c.x, v[1]-c.y]); return pointInPoly([local.x, local.y], localVerts); }
  function pointInPoly(p, poly){ // p: [x,y]
    let inside=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++){ const xi=poly[i][0], yi=poly[i][1]; const xj=poly[j][0], yj=poly[j][1]; const intersect = ((yi>p[1])!=(yj>p[1])) && (p[0] < (xj-xi)*(p[1]-yi)/(yj-yi)+xi); if(intersect) inside = !inside; } return inside; }

  function topShapeAt(pt){ for(let i=state.shapes.length-1;i>=0;i--){ const s = state.shapes[i]; if(!s.visible) continue; if(pointInPolyTransformed([pt.x,pt.y], s)) return s; } return null; }

  // Mouse interactions
  let mouse = {down:false, start:null};

  canvas.addEventListener('pointerdown', e=>{
    canvas.setPointerCapture(e.pointerId);
    mouse.down = true; mouse.start = canvasPoint(e);
    const hitV = findVertexNear(mouse.start, 8);
    if(hitV){ state.selectedShapeId = hitV.shape.id; state.selectedVertex = {shapeId:hitV.shape.id, vi:hitV.vi}; syncPropsToUI(); state.dragging = {type:'vertex', shapeId:hitV.shape.id, vi:hitV.vi, centroid:hitV.centroid}; render(); return; }
    // creation and tool logic
    if(state.currentTool === 'rect'){ // create a rect centered around click
      const w=200,h=140; const s = makeShape('rect', [[mouse.start.x-w/2,mouse.start.y-h/2],[mouse.start.x+w/2,mouse.start.y-h/2],[mouse.start.x+w/2,mouse.start.y+h/2],[mouse.start.x-w/2,mouse.start.y+h/2]]); state.shapes.push(s); normalizeLayers(); state.selectedShapeId = s.id; updateLayersList(); syncPropsToUI(); render(); return; }

    if(state.currentTool === 'select'){
      const s = topShapeAt(mouse.start);
      if(s){ state.selectedShapeId = s.id; state.selectedVertex = null; syncPropsToUI(); state.dragging = {type:'move', shapeId:s.id, last:mouse.start}; render(); }
      else { state.selectedShapeId = null; state.selectedVertex = null; syncPropsToUI(); render(); }
      return;
    }

    if(state.currentTool === 'polygon'){
      if(!state.creating){ state.creating = makeShape('polygon', [[mouse.start.x,mouse.start.y]]); state.shapes.push(state.creating); state.selectedShapeId = state.creating.id; updateLayersList(); render(); }
      else { state.creating.vertices.push([mouse.start.x,mouse.start.y]); render(); }
      return;
    }

    if(state.currentTool === 'triangle'){
      if(!state.creating){ state.creating = makeShape('triangle', [[mouse.start.x,mouse.start.y]]); state.shapes.push(state.creating); state.selectedShapeId = state.creating.id; updateLayersList(); render(); }
      else{ state.creating.vertices.push([mouse.start.x,mouse.start.y]); if(state.creating.vertices.length>=3){ state.creating = null; normalizeLayers(); render(); } }
      return;
    }

    if(state.currentTool === 'circle'){
      // start center, then drag to set radius
      state.creating = {type:'circle_temp', center: [mouse.start.x, mouse.start.y], radius:0}; state.selectedShapeId = null; render(); return;
    }
  });

  canvas.addEventListener('pointermove', e=>{
    const p = canvasPoint(e);
    if(!mouse.down) return;
    if(state.dragging){ if(state.dragging.type==='vertex'){ // move vertex in local coordinates
        const s = findById(state.dragging.shapeId); if(!s) return; const c = centroid(s.vertices); const local = toLocalPoint(p, s); const newAbs = fromLocal(local.x, local.y, s, c.x, c.y); s.vertices[state.dragging.vi][0] = newAbs.x; s.vertices[state.dragging.vi][1] = newAbs.y; render(); }
      else if(state.dragging.type==='move'){ const s = findById(state.dragging.shapeId); if(!s) return; const dx = p.x - state.dragging.last.x; const dy = p.y - state.dragging.last.y; s.vertices.forEach(v=>{ v[0]+=dx; v[1]+=dy; }); state.dragging.last = p; render(); } }

    // creating circle radius
    if(state.creating && state.creating.type==='circle_temp'){ const c = state.creating.center; const r = Math.hypot(p.x-c[0], p.y-c[1]); // approximate with polygon
      const segments = 48; const verts = []; for(let i=0;i<segments;i++){ const a = i/segments * Math.PI*2; verts.push([c[0]+Math.cos(a)*r, c[1]+Math.sin(a)*r]); } // replace or set temp
      // if temp shape already in shapes array, replace vertices, else push
      const existing = state.shapes.find(s=>s.id===state.selectedShapeId);
      if(existing && existing.type==='circle'){ existing.vertices = verts; } else if(state.shapes.includes(state.creating)){ state.creating.vertices = verts; }
      render(); }
  });

  window.addEventListener('pointerup', e=>{ mouse.down=false; if(state.dragging && state.dragging.type==='move'){ state.dragging=null; } else { state.dragging = null; }
    // finalize circle creation on pointerup
    if(state.creating && state.creating.type==='circle_temp'){ // convert temp to real shape
      const verts = state.creating.vertices || []; const s = makeShape('circle', verts); // replace last pushed temp
      // remove the temporary object from shapes and push real one
      const idx = state.shapes.findIndex(x=>x===state.creating);
      if(idx>=0) state.shapes.splice(idx,1);
      state.shapes.push(s); state.creating = null; normalizeLayers(); updateLayersList(); render(); }
  });

  // Double click completes polygon
  canvas.addEventListener('dblclick', e=>{ if(state.currentTool==='polygon' && state.creating){ if(state.creating.vertices.length>=3){ state.creating = null; normalizeLayers(); render(); } } });

  // Key actions
  window.addEventListener('keydown', e=>{
    if(e.key==='Delete' || e.key==='Backspace'){
      if(state.selectedVertex){ // delete vertex
        const s = findById(state.selectedVertex.shapeId); if(s){ s.vertices.splice(state.selectedVertex.vi,1); state.selectedVertex = null; render(); updateLayersList(); }
      } else if(state.selectedShapeId){ deleteShapeById(state.selectedShapeId); }
    }
  });

  function deleteShapeById(id){ const idx = state.shapes.findIndex(s=>s.id===id); if(idx>=0){ // release media object URLs if video
      const s = state.shapes[idx]; if(s.media && s.media.type==='video' && s.media.src){ try{ URL.revokeObjectURL(s.media.src); } catch(_){} } state.shapes.splice(idx,1); state.selectedShapeId = null; state.selectedVertex = null; normalizeLayers(); updateLayersList(); render(); }}

  // Drag & drop media
  canvas.addEventListener('dragover', e=>{ e.preventDefault(); $('#overlayInfo').style.display='block'; });
  canvas.addEventListener('dragleave', e=>{ $('#overlayInfo').style.display=''; });
  canvas.addEventListener('drop', e=>{
    e.preventDefault(); $('#overlayInfo').style.display=''; const file = e.dataTransfer.files && e.dataTransfer.files[0]; if(!file) return; const pt = canvasPoint(e); const s = topShapeAt(pt); if(!s){ status.textContent='Drop onto a shape to assign media'; return; }
    assignFileToShape(file, s);
  });

  function assignFileToShape(file, shape){ // ensure only one media per shape
    const isVideo = file.type.startsWith('video/'); if(isVideo){ if(shape.media && shape.media.type==='video' && shape.media.src) try{ URL.revokeObjectURL(shape.media.src);}catch{} const url = URL.createObjectURL(file); const v = document.createElement('video'); v.src = url; v.loop = true; v.muted = true; v.autoplay = true; v.playsInline = true; v.style.display='none'; document.body.appendChild(v); v.play().catch(()=>{}); shape.media = {type:'video', src:url, el:v}; } else { const reader = new FileReader(); reader.onload = ()=>{ const img = new Image(); img.onload = ()=>{ shape.media = {type:'image', src:reader.result, el:img}; render(); }; img.src = reader.result; }; reader.readAsDataURL(file); }
    render(); updateLayersList(); }

  function playAll(){ state.shapes.forEach(s=>{ if(s.media && s.media.type==='video' && s.media.el) s.media.el.play(); }); status.textContent='Playing'; }
  function pauseAll(){ state.shapes.forEach(s=>{ if(s.media && s.media.type==='video' && s.media.el) s.media.el.pause(); }); status.textContent='Paused'; }

  // Export / Import
  function exportJSON(){ const data = state.shapes.map(s=>({ id:s.id, type:s.type, vertices:s.vertices, opacity:s.opacity, rotation:s.rotation, scale:s.scale, layerIndex:s.layerIndex, visible:s.visible, media: s.media && s.media.type==='image' ? {type:'image', src:s.media.src} : null })); const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'}); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mapping.json'; a.click(); }
  function importJSON(text){ try{ const arr = JSON.parse(text); state.shapes = arr.map(a=> makeShape(a.type, a.vertices, {opacity:a.opacity||1, rotation:a.rotation||0, scale:a.scale||1, layerIndex:a.layerIndex||0, visible: a.visible!==false})); normalizeLayers(); updateLayersList(); render(); status.textContent='Imported'; } catch(e){ status.textContent='Import failed'; }}

  // Rendering
  function render(){ ctx.clearRect(0,0,canvas.width,canvas.height); ctx.fillStyle='#000'; ctx.fillRect(0,0,canvas.width,canvas.height); if(state.showGrid) drawGrid(); // draw shapes in order
    normalizeLayers(); state.shapes.forEach(s=>{ if(!s.visible) return; ctx.save(); ctx.globalAlpha = s.opacity; // compute centroid
      const c = centroid(s.vertices); // apply transform
      ctx.translate(c.x, c.y); ctx.rotate(s.rotation * Math.PI/180); ctx.scale(s.scale, s.scale);
      // draw media clipped to polygon once
      if(s.media && s.media.el){ ctx.save(); // create path in local coords (vertex - centroid)
        ctx.beginPath(); s.vertices.forEach((v,i)=>{ const lx = v[0]-c.x, ly = v[1]-c.y; if(i===0) ctx.moveTo(lx,ly); else ctx.lineTo(lx,ly); }); ctx.closePath(); ctx.clip(); // draw image/video stretched to bounding box of local verts
        const localBBox = bboxLocal(s.vertices, c);
        try{ ctx.drawImage(s.media.el, 0,0, s.media.el.videoWidth || s.media.el.width || localBBox.w, s.media.el.videoHeight || s.media.el.height || localBBox.h, localBBox.x, localBBox.y, localBBox.w, localBBox.h); } catch(e){}
        ctx.restore(); }
      // outline
      ctx.strokeStyle = (state.selectedShapeId === s.id) ? getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#0ff' : '#444'; ctx.lineWidth = 2;
      ctx.beginPath(); s.vertices.forEach((v,i)=>{ const lx=v[0]-c.x, ly=v[1]-c.y; if(i===0) ctx.moveTo(lx,ly); else ctx.lineTo(lx,ly); }); ctx.closePath(); ctx.stroke();
      // vertices
      s.vertices.forEach((v,i)=>{ const lx=v[0]-c.x, ly=v[1]-c.y; ctx.fillStyle='#222'; ctx.beginPath(); ctx.arc(lx,ly,6,0,Math.PI*2); ctx.fill(); ctx.strokeStyle='#000'; ctx.stroke(); if(state.selectedShapeId===s.id){ ctx.fillStyle='var(--accent)'; ctx.beginPath(); ctx.arc(lx,ly,3,0,Math.PI*2); ctx.fill(); } });
      ctx.restore(); }); syncPropsToUI(); }

  function bboxLocal(vertices, c){ let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity; vertices.forEach(v=>{ const lx=v[0]-c.x, ly=v[1]-c.y; minx=Math.min(minx,lx); miny=Math.min(miny,ly); maxx=Math.max(maxx,lx); maxy=Math.max(maxy,ly); }); return {x:minx,y:miny,w:maxx-minx,h:maxy-miny}; }

  function drawGrid(){ const step=50; ctx.save(); ctx.strokeStyle='rgba(255,255,255,0.03)'; ctx.lineWidth=1; for(let x=0;x<canvas.width;x+=step){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); } for(let y=0;y<canvas.height;y+=step){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); } ctx.restore(); }

  // Utilities
  function syncLoop(){ render(); requestAnimationFrame(syncLoop); }

  // Initialize
  function init(){ resize(); updateLayersList(); requestAnimationFrame(render); syncLoop(); }
  window.addEventListener('load', init);

  // Expose for debugging
  window._PM = { state, render, assignFileToShape };

})();
