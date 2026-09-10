const THREE = globalThis.THREE;
const DRILL_MARKERS = globalThis.WOODCASE_DRILL_MARKERS_3D;

if (!THREE) {
  throw new Error("The local Three.js runtime must load before model3d.js");
}

const WOOD = 0xd8aa62;
const WOOD_EDGE = 0x6f4a22;
const PRINTED = 0xe86561;
const PRINTED_DARK = 0x763638;
const METAL = 0x30383b;
const GRID = 0x2f7f82;

// One entry per fastener node the builders must create. This is intentionally
// more concrete than a BOM manifest: rebuild() audits the constructed scene
// against this plan, catching missing and duplicated builder calls.
function getFastenerRenderPlan(config = {}) {
  const hasHandle = config.hasHandle !== undefined
    ? Boolean(config.hasHandle)
    : Number(config.heightLevel) >= 3;
  const plan = [];
  const add = (fastener, count, builder) => {
    for (let index = 0; index < count; index += 1) plan.push({ fastener, builder, index });
  };
  add(config.cornerFastening === "wood-screws" ? "cornerWoodScrew" : "primaryM3:corners", 20, "buildCorners");
  add("primaryM3:hinges", 8, "buildHinges");
  add("primaryM3:lip", 2, "buildLid");
  add("primaryM3:lidLocks", 4, "buildLid");
  add("frameM3:lockToFrame", 4, "buildFrontHardware");
  if (hasHandle) add("frameM3:handleMounts", 4, "buildFrontHardware");
  add("hingePinM3x40", 2, "buildHinges");
  if (hasHandle && Number(config.heightLevel) !== 2) add("handleM4x50", 2, "buildFrontHardware");
  return plan;
}

function getFrontHardwareLayout(config, dimensions, thickness) {
  const compact = Number(config.heightLevel) === 3;
  const hasHandle = Boolean(config.hasHandle);
  const handleWidth = compact ? 118 : 154;
  const handleHeight = compact ? 31 : 46;
  const handleBar = compact ? 9 : 11;
  // The pivot/mount line is centered vertically on the wooden front.
  const handleTopY = dimensions.frontBackHeightMm / 2;
  const labelHeight = compact ? 14 : 18;
  const labelWidth = compact ? 84 : 112;
  const lidLockLeafHeight = 4;
  const lidLockLeafCenterY = 1.4;
  const lidLockDropHeight = 15 + (config.lidThicknessMm || thickness) - thickness;
  const lidLockCornerOverlap = 3;
  // The label sits behind the handle opening on the same horizontal datum as
  // both handle pivots. Keep this exact rather than deriving it from the
  // hanging handle geometry.
  const labelCenterY = handleTopY;
  const lipWidth = config.widthBoxes === 5 ? 40 : 95;
  return {
    hasHandle,
    compact,
    // Keep the front slider high enough to engage the lid drop while staying
    // clear of the vertically centered handle pivots.
    latchY: dimensions.frontBackHeightMm + thickness / 2 - 12,
    latchOffset: Math.min(dimensions.frontBackLengthMm * 0.31, 128),
    lockWidth: compact ? 42 : 46,
    lockHeight: compact ? 14 : 16,
    lockRailWidth: compact ? 26 : 30,
    lockRailHeight: 7,
    lockShellBar: 4,
    lockShellDepth: 9,
    lockShellFrontOffset: 6.5,
    lockSliderOffset: compact ? 3 : 4,
    lidLockLeafWidth: 38,
    lidLockLeafHeight,
    lidLockLeafCenterY,
    // Reach the front drop directly for every material thickness; this makes
    // a true two-piece L bracket without a separate connector block.
    lidLockLeafDepth: thickness + 14 + lidLockCornerOverlap * 2,
    lidLockDropWidth: 22,
    lidLockDropHeight,
    // Touch the lid's local y=0 top/edge datum so the horizontal leaf and
    // narrow front drop read as one continuous L-shaped component.
    lidLockDropCenterY: lidLockCornerOverlap - lidLockDropHeight / 2,
    lidLockCornerOverlap,
    lidLockDropDepth: 6,
    handleWidth,
    handleHeight,
    handleBar,
    handleMountWidth: compact ? 36 : 40,
    handleMountHeight: 20,
    handleMountScrewOffset: compact ? 10 : 11.5,
    handleTopY,
    handleCenterY: handleTopY - handleHeight / 2,
    handleGeometryCenterY: handleTopY - handleHeight / 2 + handleBar * 0.55,
    labelHeight,
    labelWidth,
    labelCenterY,
    lipWidth,
    lipBottomY: dimensions.sideHeightMm - 20,
  };
}

function getHingeLayout(dimensions, thickness, lidThickness = thickness) {
  const lidTop = dimensions.frontBackHeightMm + lidThickness;
  const oldLidOriginY = lidTop;
  const oldLidOriginZ = -dimensions.bottomHeightMm / 2;
  const backZ = oldLidOriginZ - 3.5; // Half the 7 mm fixed leaf seats it against the rear panel.
  const axisY = lidTop - 1.5;
  const axisZ = backZ - 2;
  const fixedLeafHeight = 30 + lidThickness - thickness;
  const fixedLeafCenterY = lidTop - 2 - fixedLeafHeight / 2;
  const fixedScrewY = dimensions.sideHeightMm - 19;
  const movingLeafHeight = 6;
  const movingLeafDepth = 30 + thickness / 2;
  return {
    backZ,
    axisY,
    axisZ,
    // The nested assembly keeps every closed-state lid coordinate unchanged,
    // while its parent rotates exactly around the visible hinge-pin axis.
    assemblyOffsetY: oldLidOriginY - axisY,
    assemblyOffsetZ: oldLidOriginZ - axisZ,
    fixedLeafHeight,
    fixedLeafCenterY,
    fixedScrewY,
    // The lid's local top plane is y=0. Put the complete moving leaf above
    // that plane, then extend its rear edge to the hinge-pin barrel.
    movingLeafHeight,
    movingLeafDepth,
    movingLeafCenterY: movingLeafHeight / 2,
    movingLeafTopY: movingLeafHeight,
    movingLeafCenterZ: 13 - thickness / 4,
    movingScrewZ: 16,
  };
}

function normalizeOrbitAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function formatCaseLabel(config) {
  return `${Number(config.materialThicknessMm)}mm ${Number(config.widthBoxes)}x${Number(config.depthBoxes)} ${Number(config.heightLevel)}H`;
}

function countFasteners(entries) {
  return entries.reduce((counts, entry) => {
    const key = entry.fastener || entry;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function getFastenerManifest(config = {}) {
  const counts = countFasteners(getFastenerRenderPlan(config));
  return {
    primaryM3: {
      corners: counts["primaryM3:corners"] || 0,
      hinges: counts["primaryM3:hinges"] || 0,
      lip: counts["primaryM3:lip"] || 0,
      lidLocks: counts["primaryM3:lidLocks"] || 0,
      total: Object.entries(counts).filter(([key]) => key.startsWith("primaryM3:")).reduce((sum, entry) => sum + entry[1], 0),
    },
    frameM3: {
      lockToFrame: counts["frameM3:lockToFrame"] || 0,
      handleMounts: counts["frameM3:handleMounts"] || 0,
      total: Object.entries(counts).filter(([key]) => key.startsWith("frameM3:")).reduce((sum, entry) => sum + entry[1], 0),
    },
    hingePinM3x40: counts.hingePinM3x40 || 0,
    handleM4x50: counts.handleM4x50 || 0,
    cornerWoodScrew: counts.cornerWoodScrew || 0,
  };
}

function countFastenerNodes(root) {
  const nodes = [];
  root.traverse((object) => {
    if (object.userData && object.userData.fastener) nodes.push(object.userData.fastener);
  });
  return countFasteners(nodes);
}

function verifyFastenerAssembly(root, config) {
  const expected = countFasteners(getFastenerRenderPlan(config));
  const actual = countFastenerNodes(root);
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const key of keys) {
    if ((actual[key] || 0) !== (expected[key] || 0)) {
      throw new Error(`3D fastener count mismatch for ${key}: expected ${expected[key] || 0}, built ${actual[key] || 0}`);
    }
  }
  return actual;
}

function disposeObject(root) {
  root.traverse((object) => {
    if (object.geometry) object.geometry.dispose();
    if (object.userData && object.userData.disposableMaterial && object.material) {
      if (object.material.map) object.material.map.dispose();
      object.material.dispose();
    }
  });
}

class WoodCaseViewer {
  constructor(element) {
    this.element = element;
    this.yaw = -0.72;
    this.pitch = 0.48;
    this.distance = this.fitDistance = 720;
    this.target = new THREE.Vector3(0, 45, 0);
    this.dragging = false;
    this.pointerId = null;
    this.lastX = 0;
    this.lastY = 0;
    this.open = true;
    this.bom = null;
    this.panelGeometry = null;
    this.lidAnimationFrame = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 1, 4000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute("aria-label", "Rotatable 3D model of the configured ModuBOX wood case");
    this.element.replaceChildren(this.renderer.domElement);
    this.woodTexture = this.createWoodTexture();
    this.materials = {
      clear: new THREE.MeshStandardMaterial({ color: 0xbfe7ef, transparent: true, opacity: 0.2, depthWrite: false, roughness: 0.12, metalness: 0.08, side: THREE.DoubleSide }),
      wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: this.woodTexture, roughness: 0.68, metalness: 0.01 }),
      printed: new THREE.MeshStandardMaterial({ color: PRINTED, roughness: 0.46, metalness: 0.02 }),
      printedDark: new THREE.MeshStandardMaterial({ color: PRINTED_DARK, roughness: 0.55 }),
      metal: new THREE.MeshStandardMaterial({ color: METAL, roughness: 0.3, metalness: 0.75 }),
      fastener: new THREE.MeshStandardMaterial({ color: 0xcbd2d5, roughness: 0.24, metalness: 0.88 }),
      grid: new THREE.MeshStandardMaterial({ color: GRID, roughness: 0.42 }),
      gridBase: new THREE.MeshStandardMaterial({ color: 0xdcefee, transparent: true, opacity: 0.48, roughness: 0.7 }),
      drill: new THREE.MeshBasicMaterial({ color: 0x8c2424, side: THREE.DoubleSide }),
      ground: new THREE.MeshStandardMaterial({ color: 0xf1f3ee, roughness: 1 }),
    };
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8f7b66, 2.15);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(-380, 620, 420);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -650;
    key.shadow.camera.right = 650;
    key.shadow.camera.top = 650;
    key.shadow.camera.bottom = -650;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffe2bc, 1.25);
    fill.position.set(420, 250, -320);
    this.scene.add(fill);
    this.caseGroup = new THREE.Group();
    this.scene.add(this.caseGroup);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1300), this.materials.ground);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.8;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.bindEvents();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.resize();
    this.render();
  }
  createWoodTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ddb36f";
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let line = 0; line < 86; line += 1) {
      const baseY = (line / 85) * canvas.height;
      context.beginPath();
      for (let x = 0; x <= canvas.width; x += 8) {
        const wave = Math.sin(x * 0.025 + line * 0.71) * (1.4 + (line % 5) * 0.32);
        const drift = Math.sin(x * 0.006 + line * 0.19) * 3.2;
        const y = baseY + wave + drift;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.strokeStyle = line % 4 === 0 ? "rgba(120,71,26,0.18)" : "rgba(255,232,184,0.22)";
      context.lineWidth = line % 4 === 0 ? 1.15 : 0.75;
      context.stroke();
    }
    for (const [x, y, radius] of [[118, 78, 13], [382, 178, 17]]) {
      context.beginPath();
      context.ellipse(x, y, radius * 1.8, radius * 0.55, -0.12, 0, Math.PI * 2);
      context.strokeStyle = "rgba(111,65,25,0.2)";
      context.lineWidth = 2;
      context.stroke();
      context.beginPath();
      context.ellipse(x, y, radius, radius * 0.28, -0.12, 0, Math.PI * 2);
      context.strokeStyle = "rgba(92,50,19,0.22)";
      context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
  bindEvents() {
    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointerdown", (event) => {
      this.dragging = true;
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      this.element.classList.add("is-dragging");
    });
    canvas.addEventListener("pointermove", (event) => {
      if (!this.dragging || event.pointerId !== this.pointerId) return;
      this.yaw -= (event.clientX - this.lastX) * 0.008;
      this.pitch = normalizeOrbitAngle(this.pitch + (event.clientY - this.lastY) * 0.006);
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.render();
    });
    const stop = (event) => {
      if (event.pointerId !== this.pointerId) return;
      this.dragging = false;
      this.pointerId = null;
      this.element.classList.remove("is-dragging");
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(event.deltaY * 0.001), 300, Math.max(1500, this.fitDistance * 2));
      this.render();
    }, { passive: false });
  }
  resize() {
    const width = Math.max(280, this.element.clientWidth);
    const height = Math.max(360, this.element.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.fitView();
    this.render();
  }
  fitView() {
    const bounds = new THREE.Box3().setFromObject(this.caseGroup);
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    this.target.copy(sphere.center);
    const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * Math.min(1, this.camera.aspect));
    this.distance = this.fitDistance = sphere.radius / Math.sin(halfFov) * 1.06;
    this.camera.far = Math.max(4000, this.fitDistance * 2 + sphere.radius * 2);
    this.camera.updateProjectionMatrix();
  }
  render() {
    const horizontal = Math.cos(this.pitch) * this.distance;
    this.camera.position.set(
      this.target.x + Math.sin(this.yaw) * horizontal,
      this.target.y + Math.sin(this.pitch) * this.distance,
      this.target.z + Math.cos(this.yaw) * horizontal,
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }
  addEdges(mesh, color = WOOD_EDGE, opacity = 0.62) {
    const lines = new THREE.LineSegments(
      new THREE.EdgesGeometry(mesh.geometry, 24),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
    );
    mesh.add(lines);
    return mesh;
  }
  box(parent, size, position, material, options = {}) {
    const geometry = new THREE.BoxGeometry(size[0], size[1], size[2], 1, 1, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = options.castShadow !== false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (options.edges !== false) this.addEdges(mesh, options.edgeColor || WOOD_EDGE, options.edgeOpacity || 0.58);
    return mesh;
  }
  cylinder(parent, radius, length, position, rotation = [Math.PI / 2, 0, 0], material = this.materials.metal) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 14), material);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  screw(parent, x, y, z, surface = "front", fastener = "primaryM3") {
    const sideSurface = surface === "side" || surface === "side-left";
    const rotation = (surface === "top" || surface === "bottom") ? [0, 0, 0] : sideSurface ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0];
    const normal = surface === "front" ? [0, 0, 1]
      : surface === "back" ? [0, 0, -1]
        : surface === "top" ? [0, 1, 0] : surface === "bottom" ? [0, -1, 0]
          : surface === "side" ? [1, 0, 0]
            : [-1, 0, 0];
    if (fastener === "cornerWoodScrew") {
      const head = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 1.5, 2, 20), this.materials.fastener);
      head.position.set(x - normal[0] * 0.8, y - normal[1] * 0.8, z - normal[2] * 0.8);
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...normal));
      head.name = `fastener:${fastener}`;
      head.userData.fastener = fastener;
      parent.add(head);
      const slot = this.box(head, [2.5, 0.15, 0.45], [0, 1.02, 0], this.materials.printedDark, { edges: false });
      slot.castShadow = false;
      return head;
    }
    const washerPosition = [x + normal[0] * 0.45, y + normal[1] * 0.45, z + normal[2] * 0.45];
    const headPosition = [x + normal[0] * 1.25, y + normal[1] * 1.25, z + normal[2] * 1.25];
    this.cylinder(parent, 3.15, 0.65, washerPosition, rotation, this.materials.fastener);
    const head = this.cylinder(parent, 2.45, 1.35, headPosition, rotation, this.materials.fastener);
    head.name = `fastener:${fastener}`;
    head.userData.fastener = fastener;
    const slotPosition = [x + normal[0] * 2, y + normal[1] * 2, z + normal[2] * 2];
    const slotSize = sideSurface ? [0.38, 0.38, 1.75] : [1.75, 0.34, 0.38];
    this.box(parent, slotSize, slotPosition, this.materials.printedDark, { edges: false, castShadow: false });
    return head;
  }
  socketBolt(parent, x, y, z) {
    this.cylinder(parent, 4.1, 0.8, [x, y, z - 1.8], [Math.PI / 2, 0, 0], this.materials.fastener);
    const head = this.cylinder(parent, 3.35, 3.2, [x, y, z], [Math.PI / 2, 0, 0], this.materials.fastener);
    head.name = "fastener:handleM4x50";
    head.userData.fastener = "handleM4x50";
    this.cylinder(parent, 1.25, 0.7, [x, y, z + 2.15], [Math.PI / 2, 0, 0], this.materials.printedDark);
    return head;
  }
  printedBox(parent, size, position, options = {}) {
    return this.box(parent, size, position, this.materials.printed, { edgeColor: PRINTED_DARK, edgeOpacity: 0.8, ...options });
  }
  roundedPlate(parent, width, height, depth, position, options = {}) {
    const radius = Math.min(options.radius || 4, width / 2, height / 2);
    const x = -width / 2;
    const y = -height / 2;
    const shape = new THREE.Shape();
    shape.moveTo(x + radius, y);
    shape.lineTo(x + width - radius, y);
    shape.quadraticCurveTo(x + width, y, x + width, y + radius);
    shape.lineTo(x + width, y + height - radius);
    shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    shape.lineTo(x + radius, y + height);
    shape.quadraticCurveTo(x, y + height, x, y + height - radius);
    shape.lineTo(x, y + radius);
    shape.quadraticCurveTo(x, y, x + radius, y);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: options.bevel !== false,
      bevelSegments: 2,
      bevelSize: Math.min(1.2, depth * 0.2),
      bevelThickness: Math.min(1.2, depth * 0.2),
      curveSegments: 5,
    });
    geometry.translate(0, 0, -depth / 2);
    const mesh = new THREE.Mesh(geometry, options.material || this.materials.printed);
    mesh.position.set(...position);
    if (options.rotation) mesh.rotation.set(...options.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    this.addEdges(mesh, options.edgeColor || PRINTED_DARK, 0.65);
    return mesh;
  }
  caseLabel(parent, config, width, height, position) {
    const label = formatCaseLabel(config);
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 160;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#202425";
    context.font = "700 76px system-ui, -apple-system, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(label, canvas.width / 2, canvas.height / 2 + 2);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    mesh.position.set(...position);
    mesh.name = `case-label:${label}`;
    mesh.renderOrder = 5;
    mesh.userData.caseLabel = label;
    mesh.userData.disposableMaterial = true;
    parent.add(mesh);
    return mesh;
  }
  chamferedUHandle(parent, width, height, bar, depth, position) {
    const group = new THREE.Group();
    group.position.set(...position);
    parent.add(group);
    const halfW = width / 2;
    const topY = height / 2;
    const verticalDrop = Math.max(8, height * 0.28);
    const diagonalDrop = Math.max(10, height * 0.34);
    const diagonalInset = diagonalDrop;
    const joinY = topY - verticalDrop;
    const bottomY = joinY - diagonalDrop;
    const addBarBetween = (x1, y1, x2, y2) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const length = Math.hypot(dx, dy) + bar * 0.35;
      return this.roundedPlate(group, length, bar, depth, [(x1 + x2) / 2, (y1 + y2) / 2, 0], {
        radius: bar * 0.45,
        rotation: [0, 0, Math.atan2(dy, dx)],
      });
    };
    // Each side has a vertical run, a 45° diagonal, then the horizontal
    // grip: two explicit 45° turns instead of a single rounded 90° corner.
    addBarBetween(-halfW, topY, -halfW, joinY);
    addBarBetween(-halfW, joinY, -halfW + diagonalInset, bottomY);
    addBarBetween(halfW, topY, halfW, joinY);
    addBarBetween(halfW, joinY, halfW - diagonalInset, bottomY);
    addBarBetween(-halfW + diagonalInset, bottomY, halfW - diagonalInset, bottomY);
    return group;
  }
  buildGrid(parent, config, d, t) {
    const width = config.widthBoxes * 55;
    const depth = config.depthBoxes * 55;
    const y = t + 1.15;
    this.box(parent, [width - 2, 1.25, depth - 2], [0, y, 0], this.materials.gridBase, { edges: false, castShadow: false });
    for (let column = 0; column <= config.widthBoxes; column += 1) {
      const x = -width / 2 + column * 55;
      this.box(parent, [2.2, 2.2, depth], [x, y + 1.1, 0], this.materials.grid, { edges: false });
    }
    for (let row = 0; row <= config.depthBoxes; row += 1) {
      const z = -depth / 2 + row * 55;
      this.box(parent, [width, 2.2, 2.2], [0, y + 1.1, z], this.materials.grid, { edges: false });
    }
  }
  buildCorners(parent, outerWidth, outerDepth, sideHeight, t, config) {
    const rail = Math.max(20, t + 10);
    const shell = 6;
    const fastener = config.cornerFastening === "wood-screws" ? "cornerWoodScrew" : "primaryM3:corners";
    for (const xSign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const x = xSign * outerWidth / 2;
        const z = zSign * outerDepth / 2;
        this.roundedPlate(parent, rail, sideHeight + 10, shell, [x - xSign * rail * 0.12, sideHeight / 2, z + zSign * (t / 2 + 2.5)], { radius: 5 });
        this.roundedPlate(parent, rail, sideHeight + 10, shell, [x + xSign * (t / 2 + 2.5), sideHeight / 2, z - zSign * rail * 0.12], { radius: 5, rotation: [0, Math.PI / 2, 0] });
        // Rounded top cap and bottom foot wrap inward around each wood corner.
        this.printedBox(parent, [rail + 10, 5, rail + 10], [x - xSign * 5, sideHeight + 1.5, z - zSign * 5], { edgeOpacity: 0.55 });
        // Leave a 4 mm rim inward of the bottom screw axis at t + 10.
        this.printedBox(parent, [t + 24, 5, t + 24], [x - xSign * (t / 2 + 2), 2, z - zSign * (t / 2 + 2)], { edgeOpacity: 0.55 }).name = "corner:bottom-foot";
        this.screw(parent, x - xSign * (t + 10), -0.5, z - zSign * (t + 10), "bottom", fastener);
        // Two wall fasteners per leg, plus the separate bottom fastener.
        for (const fraction of [0.27, 0.73]) {
          const y = sideHeight * fraction;
          this.screw(parent, x - xSign * rail * 0.12, y, z + zSign * (t / 2 + 5.7), zSign > 0 ? "front" : "back", fastener);
          this.screw(parent, x + xSign * (t / 2 + 5.7), y, z - zSign * rail * 0.12, xSign > 0 ? "side" : "side-left", fastener);
        }
      }
    }
  }
  buildFrontHardware(parent, config, d, t) {
    const frontZ = d.bottomHeightMm / 2 + t / 2 + 3.2;
    const layout = getFrontHardwareLayout(config, d, t);
    // Matches the closed lid tongue datum for every H; it must not drift down
    // the panel as taller cases are selected.
    const {
      latchY,
      latchOffset,
      lockWidth,
      lockHeight,
      lockRailWidth,
      lockRailHeight,
      lockShellBar,
      lockShellDepth,
      lockShellFrontOffset,
      lockSliderOffset,
    } = layout;
    for (const x of [-latchOffset, latchOffset]) {
      // Part 2: the only component fixed to the wooden front is this small
      // rounded rail. Its two M3 screws remain visible through the opening.
      const rail = this.roundedPlate(parent, lockRailWidth, lockRailHeight, 6, [x, latchY, frontZ + 2.5], {
        radius: 3,
        material: this.materials.printedDark,
        bevel: false,
      });
      rail.name = "front-lock:fixed-rail";
      this.screw(parent, x - lockRailWidth * 0.27, latchY, frontZ + 6.1, "front", "frameM3:lockToFrame");
      this.screw(parent, x + lockRailWidth * 0.27, latchY, frontZ + 6.1, "front", "frameM3:lockToFrame");
      // Part 3: a screwless sliding shell wraps around the fixed rail. Four
      // simple bars leave the rail and its two mounting screws visible.
      const shellDepth = lockShellDepth;
      // Mirror the unlocked-looking travel direction: each shell sits a few
      // millimetres toward its nearest corner while the rail remains fixed.
      const sliderX = x + Math.sign(x) * lockSliderOffset;
      // Sit close enough to the case for the slider to overlap the lid's
      // descending L-piece in the closed state, like the physical lock.
      const shellZ = frontZ + lockShellFrontOffset;
      const halfInnerHeight = (lockHeight - lockShellBar) / 2;
      const top = this.roundedPlate(parent, lockWidth, lockShellBar, shellDepth, [sliderX, latchY + halfInnerHeight, shellZ], { radius: 2.5 });
      const bottom = this.roundedPlate(parent, lockWidth, lockShellBar, shellDepth, [sliderX, latchY - halfInnerHeight, shellZ], { radius: 2.5 });
      const left = this.roundedPlate(parent, lockShellBar, lockHeight, shellDepth, [sliderX - (lockWidth - lockShellBar) / 2, latchY, shellZ], { radius: 2.5 });
      const right = this.roundedPlate(parent, lockShellBar, lockHeight, shellDepth, [sliderX + (lockWidth - lockShellBar) / 2, latchY, shellZ], { radius: 2.5 });
      for (const part of [top, bottom, left, right]) part.name = "front-lock:screwless-slider-shell";
    }
    if (!config.hasHandle) return;
    if (config.heightLevel === 2) {
      const frontZ = d.bottomHeightMm / 2 + 1.3; // Seat the 2.6 mm backing; the locks keep their own datum.
      this.roundedPlate(parent, 221, 36, 2.6, [0, 18, frontZ], { radius: 3, bevel: false }).name = "handle:fixed-backing";
      const grip = new THREE.Group();
      grip.name = "handle:fixed-grip";
      parent.add(grip);
      this.roundedPlate(grip, 221, 17.8, 10.8, [0, 10, frontZ + 6.7], { radius: 3 });
      for (const x of [-100, 100]) this.printedBox(grip, [21, 17.8, 32.4], [x, 10, frontZ + 17]);
      this.roundedPlate(grip, 221, 17.8, 11, [0, 10, frontZ + 28], { radius: 5 });
      this.caseLabel(parent, config, 90, 10, [0, 29, frontZ + 2]);
      for (const x of [-102, -65, 65, 102]) this.screw(parent, x, 7.25, frontZ + 8, "front", "frameM3:handleMounts");
      return;
    }
    const {
      handleWidth,
      handleHeight,
      handleBar,
      handleMountWidth,
      handleMountHeight,
      handleMountScrewOffset,
      handleTopY: topY,
      handleGeometryCenterY,
      labelHeight,
      labelWidth,
      labelCenterY,
    } = layout;
    const labelPlate = this.roundedPlate(parent, labelWidth, labelHeight, 5, [0, labelCenterY, frontZ + 1], { radius: 4 });
    labelPlate.name = "handle:label-plate";
    this.caseLabel(parent, config, labelWidth - 9, labelHeight - 5, [0, labelCenterY, frontZ + 5.2]);
    this.chamferedUHandle(parent, handleWidth, handleHeight, handleBar, 8, [0, handleGeometryCenterY, frontZ + 12]);
    for (const x of [-handleWidth / 2, handleWidth / 2]) {
      const mount = this.roundedPlate(parent, handleMountWidth, handleMountHeight, 13, [x, topY, frontZ + 6], { radius: 4 });
      mount.name = "handle:wide-visible-screw-mount";
      this.screw(parent, x - handleMountScrewOffset, topY, frontZ + 12.5, "front", "frameM3:handleMounts");
      this.screw(parent, x + handleMountScrewOffset, topY, frontZ + 12.5, "front", "frameM3:handleMounts");
      this.socketBolt(parent, x, topY, frontZ + 14);
    }
  }
  buildHinges(parent, lidPivot, d, t, lidThickness = t) {
    const hinge = getHingeLayout(d, t, lidThickness);
    const { backZ } = hinge;
    const offset = Math.min(d.frontBackLengthMm * 0.3, 125);
    const lidAssembly = lidPivot.userData.lidAssembly || lidPivot;
    for (const x of [-offset, offset]) {
      const fixedLeaf = this.printedBox(parent, [42, hinge.fixedLeafHeight, 7], [x, hinge.fixedLeafCenterY, backZ]);
      fixedLeaf.name = "hinge:fixed-back-leaf";
      this.screw(parent, x - 12, hinge.fixedScrewY, backZ - 4.2, "back", "primaryM3:hinges");
      this.screw(parent, x + 12, hinge.fixedScrewY, backZ - 4.2, "back", "primaryM3:hinges");
      // The moving leaf sits visibly on top of the wood lid and rotates with
      // it. Its thickness begins exactly at the lid's y=0 top surface.
      const movingLeaf = this.printedBox(
        lidAssembly,
        [42, hinge.movingLeafHeight, hinge.movingLeafDepth],
        [x, hinge.movingLeafCenterY, hinge.movingLeafCenterZ],
      );
      movingLeaf.name = "hinge:moving-lid-top-leaf";
      this.screw(lidAssembly, x - 12, hinge.movingLeafTopY, hinge.movingScrewZ, "top", "primaryM3:hinges");
      this.screw(lidAssembly, x + 12, hinge.movingLeafTopY, hinge.movingScrewZ, "top", "primaryM3:hinges");
      const pin = this.cylinder(parent, 3.1, 40, [x, hinge.axisY, hinge.axisZ], [0, 0, Math.PI / 2], this.materials.metal);
      pin.name = "fastener:hingePinM3x40";
      pin.userData.fastener = "hingePinM3x40";
    }
  }
  buildLid(parent, config, d, t) {
    const lt = config.lidThicknessMm;
    const hinge = getHingeLayout(d, t, lt);
    const pivot = new THREE.Group();
    pivot.position.set(0, hinge.axisY, hinge.axisZ);
    pivot.rotation.x = this.open ? THREE.MathUtils.degToRad(-108) : 0;
    parent.add(pivot);
    this.lidPivot = pivot;
    const lidAssembly = new THREE.Group();
    lidAssembly.position.set(0, hinge.assemblyOffsetY, hinge.assemblyOffsetZ);
    pivot.add(lidAssembly);
    pivot.userData.lidAssembly = lidAssembly;
    this.lidAssembly = lidAssembly;
    // Retrofit: body dimensions stay fixed; the lid rests on the front/back.
    const lid = this.box(lidAssembly, [d.lidWidthMm, lt, d.lidHeightMm], [0, -lt / 2, d.lidHeightMm / 2], config.clearLid ? this.materials.clear : this.materials.wood, { castShadow: !config.clearLid, edgeColor: config.clearLid ? 0x4b929e : WOOD_EDGE });
    lid.name = config.clearLid ? "lid:transparent-panel" : "lid:wood-panel";
    if (config.clearLid) lid.renderOrder = 2;
    const frontZ = d.lidHeightMm + t / 2 + 2.5;
    const layout = getFrontHardwareLayout(config, d, t);
    const {
      latchOffset,
      lidLockLeafWidth,
      lidLockLeafDepth,
      lidLockLeafHeight,
      lidLockLeafCenterY,
      lidLockDropWidth,
      lidLockDropHeight,
      lidLockDropDepth,
      lidLockDropCenterY,
    } = layout;
    for (const x of [-latchOffset, latchOffset]) {
      // Part 1: one static 90° lid bracket. A thin mounting leaf lies on the
      // lid and turns down over the front edge to meet the sliding front lock.
      const lidLeaf = this.roundedPlate(lidAssembly, lidLockLeafWidth, lidLockLeafHeight, lidLockLeafDepth, [x, lidLockLeafCenterY, d.lidHeightMm - 7], { radius: 3 });
      lidLeaf.name = "lid-lock:horizontal-mounted-leaf";
      const frontDropX = x - Math.sign(x) * (lidLockLeafWidth - lidLockDropWidth) / 2;
      const frontDrop = this.roundedPlate(lidAssembly, lidLockDropWidth, lidLockDropHeight, lidLockDropDepth, [frontDropX, lidLockDropCenterY, frontZ], { radius: 4 });
      frontDrop.name = "lid-lock:narrow-attached-front-drop";
      // Two fasteners per lock belong to the horizontal lid leaf. The leaf
      // reaches the vertical drop directly, so there is no third connector.
      for (const dx of [-11, 11]) {
        this.screw(lidAssembly, x + dx, 3.6, d.lidHeightMm - 7, "top", "primaryM3:lidLocks");
      }
    }
    const { lipWidth } = layout;
    // Inverted L profile: its apron points down over the front edge in the
    // closed state; no component projects upward as in the old placeholder.
    this.printedBox(lidAssembly, [lipWidth, 2.4, 16], [0, 0.7, d.lidHeightMm - 5]);
    const lipHeight = config.lipStyle === "thin" ? 12.5 : 20;
    this.roundedPlate(lidAssembly, lipWidth, lipHeight, 5, [0, -lipHeight / 2, frontZ], { radius: 3 }).name = `lip:${config.lipStyle}`;
    this.screw(lidAssembly, -lipWidth * 0.34, 2.4, d.lidHeightMm - 5, "top", "primaryM3:lip");
    this.screw(lidAssembly, lipWidth * 0.34, 2.4, d.lidHeightMm - 5, "top", "primaryM3:lip");
    return pivot;
  }
  buildDrillMarkers(geometry, dimensions) {
    if (!DRILL_MARKERS || !geometry) return;
    const plan = DRILL_MARKERS.createDrillMarkerPlan(geometry, dimensions);
    for (const marker of plan) {
      const mesh = new THREE.Mesh(
        new THREE.CircleGeometry(marker.radiusMm, 24),
        this.materials.drill,
      );
      mesh.position.set(...marker.position);
      mesh.rotation.set(...marker.rotation);
      mesh.name = `drill-marker:${marker.id}`;
      mesh.userData.drillMarker = {
        id: marker.id,
        role: marker.role,
        diameterMm: marker.diameterMm,
      };
      (marker.parent === "lid" ? this.lidAssembly : this.caseGroup).add(mesh);
    }
  }
  rebuild(bom) {
    disposeObject(this.caseGroup);
    this.scene.remove(this.caseGroup);
    this.caseGroup = new THREE.Group();
    this.scene.add(this.caseGroup);
    const config = bom.configuration;
    const d = bom.dimensions;
    const t = config.materialThicknessMm;
    const outerWidth = d.bottomWidthMm;
    const outerDepth = d.bottomHeightMm;
    this.box(this.caseGroup, [outerWidth, t, outerDepth], [0, t / 2, 0], this.materials.wood);
    this.box(this.caseGroup, [t, d.sideHeightMm, outerDepth], [-outerWidth / 2 + t / 2, d.sideHeightMm / 2, 0], this.materials.wood);
    this.box(this.caseGroup, [t, d.sideHeightMm, outerDepth], [outerWidth / 2 - t / 2, d.sideHeightMm / 2, 0], this.materials.wood);
    this.box(this.caseGroup, [d.frontBackLengthMm, d.frontBackHeightMm, t], [0, d.frontBackHeightMm / 2, outerDepth / 2 - t / 2], this.materials.wood);
    this.box(this.caseGroup, [d.frontBackLengthMm, d.frontBackHeightMm, t], [0, d.frontBackHeightMm / 2, -outerDepth / 2 + t / 2], this.materials.wood);
    this.buildGrid(this.caseGroup, config, d, t);
    this.buildCorners(this.caseGroup, outerWidth, outerDepth, d.sideHeightMm, t, config);
    this.buildFrontHardware(this.caseGroup, config, d, t);
    const lidPivot = this.buildLid(this.caseGroup, config, d, t);
    this.buildHinges(this.caseGroup, lidPivot, d, t, config.lidThicknessMm);
    this.buildDrillMarkers(this.panelGeometry, d);
    this.fastenerCounts = verifyFastenerAssembly(this.caseGroup, config);
    this.fitView();
    this.render();
  }
  update(bom, geometry) {
    this.bom = bom;
    this.panelGeometry = geometry || null;
    this.rebuild(bom);
  }
  setOpen(open) {
    const nextOpen = Boolean(open);
    this.open = nextOpen;
    if (!this.lidPivot) {
      if (this.bom) this.rebuild(this.bom);
      return;
    }
    if (this.lidAnimationFrame) cancelAnimationFrame(this.lidAnimationFrame);
    const startAngle = this.lidPivot.rotation.x;
    const targetAngle = nextOpen ? THREE.MathUtils.degToRad(-108) : 0;
    const startedAt = performance.now();
    const duration = 320;
    const animate = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      this.lidPivot.rotation.x = THREE.MathUtils.lerp(startAngle, targetAngle, eased);
      this.fitView();
      this.render();
      if (progress < 1) this.lidAnimationFrame = requestAnimationFrame(animate);
      else this.lidAnimationFrame = null;
    };
    this.lidAnimationFrame = requestAnimationFrame(animate);
  }
  reset() {
    this.yaw = -0.72;
    this.pitch = 0.48;
    if (this.bom) this.rebuild(this.bom);
    else this.render();
  }
}

globalThis.WOODCASE_3D = {
  getFastenerRenderPlan,
  getFrontHardwareLayout,
  getHingeLayout,
  normalizeOrbitAngle,
  formatCaseLabel,
  countFasteners,
  getFastenerManifest,
  countFastenerNodes,
  verifyFastenerAssembly,
  mount(element) {
    try {
      return new WoodCaseViewer(element);
    } catch (error) {
      console.warn("3D preview unavailable", error);
      return null;
    }
  },
};
