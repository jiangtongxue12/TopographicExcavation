function GroundLayer(options) {
    options = options || {};
    this.view = view;
    this.vertices = options.vertices || [];
    this.depth = options.depth || 0;
    this.centerOrigin = options.centerOrigin || [0, 0, 0];
    this.centerOrigin[2] = this.depth;
    this.slice = null;
    this.externalRenderers = options.externalRenderers;
    this.SliceClass = options.Slice;
    this.SliceViewModel = options.SliceViewModel;
    this.Graphic = options.Graphic;
    this.Point = options.Point;
    this.Polyline = options.Polyline;
    this.Polygon = options.Polygon;
    this.geometryEngine = options.geometryEngine;
    this.cutPlanes = [];
    //
    this.pointMaxNum=30;
    this.polygonMaxNum=8;//过大影响效率，非必要不修改
}
GroundLayer.prototype.setup = function (context) {
    let THREE = window.THREE;
    this.renderer = new THREE.WebGLRenderer({
        context: context.gl, // 可用于将渲染器附加到已有的渲染环境(RenderingContext)中
        premultipliedAlpha: false, // renderer是否假设颜色有 premultiplied alpha. 默认为true
    });
    this.renderer.setPixelRatio(window.devicePixelRatio); // 设置设备像素比。通常用于避免HiDPI设备上绘图模糊
    this.renderer.setViewport(0, 0, this.view.width, this.view.height); // 视口大小设置

    this.renderer.autoClear = false;
    this.renderer.autoClearDepth = false;
    this.renderer.autoClearColor = false; 
    this.renderer.autoClearStencil = false;

    let originalSetRenderTarget = this.renderer.setRenderTarget.bind(this.renderer);
    this.renderer.setRenderTarget = function (target) {
        originalSetRenderTarget(target);
        if (target == null) {
            context.bindRenderTarget();
        }
    };

    this.scene = new THREE.Scene();
    // setup the camera
    let cam = context.camera;
    this.camera = new THREE.PerspectiveCamera(cam.fovY, cam.aspect, cam.near, cam.far);

    // 添加坐标轴辅助工具
    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.position.copy(1000000, 100000, 100000);
    this.scene.add(axesHelper);

    let grid = new THREE.GridHelper(30, 10, 0xf0f0f0, 0xffffff);
    this.scene.add(grid);

    // setup scene lighting
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.5);
    this.sun.position.set(-600, 300, 60000);
    this.scene.add(this.sun);

    this.createBaseGeometry(this.vertices);
    context.resetWebGLState();
}
GroundLayer.prototype.render = function (context) {
    let THREE = window.THREE;
    let cam = context.camera;
    //需要调整相机的视角
    this.camera.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
    this.camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
    this.camera.lookAt(new THREE.Vector3(cam.center[0], cam.center[1], cam.center[2]));
    // Projection matrix can be copied directly
    this.camera.projectionMatrix.fromArray(cam.projectionMatrix);
    // update lighting
    /////////////////////////////////////////////////////////////////////////////////////////////////////
    // view.environment.lighting.date = Date.now();
    let l = context.sunLight;
    this.sun.position.set(
        l.direction[0],
        l.direction[1],
        l.direction[2]
    );
    this.sun.intensity = l.diffuse.intensity;
    this.sun.color = new THREE.Color(l.diffuse.color[0], l.diffuse.color[1], l.diffuse.color[2]);
    this.ambient.intensity = l.ambient.intensity;
    this.ambient.color = new THREE.Color(l.ambient.color[0], l.ambient.color[1], l.ambient.color[2]);

    // draw the scene
    /////////////////////////////////////////////////////////////////////////////////////////////////////
    // this.renderer.resetGLState();
    this.renderer.state.reset();
    this.renderer.render(this.scene, this.camera);
    // as we want to smoothly animate the ISS movement, immediately request a re-render
    this.externalRenderers.requestRender(this.view);
    // cleanup
    context.resetWebGLState();
}
//修改支持多次开挖
GroundLayer.prototype.createBaseGeometry = function (vertices) {
    let that = this;
    this.slice && this.slice.destroy();
    let num = vertices.length > this.pointMaxNum ? this.pointMaxNum : vertices.length;
    let array = new Array(this.pointMaxNum);
    for (let k = 0; k < this.pointMaxNum; k++) {
        array[k] = new THREE.Vector3(0, 0, 0);
    }
    let centerP = [];
    this.externalRenderers.toRenderCoordinates(view, this.centerOrigin, 0, view.spatialReference, centerP, 0, 1);
    let originP = [];
    let vector3List = [];
    let depth=this.depth;
    for (let k = 0; k < num; k++) {
        let target = [];
        if (k == 0) {
            this.externalRenderers.toRenderCoordinates(view, [vertices[k][0], vertices[k][1],depth], 0, view.spatialReference, originP, 0, 1);
            array[k] = new THREE.Vector3(originP[0], originP[1], originP[2]);
            target = originP;
        } else {
            this.externalRenderers.toRenderCoordinates(view, [vertices[k][0], vertices[k][1],depth], 0, view.spatialReference, target, 0, 1);
            array[k] = new THREE.Vector3(target[0] - originP[0], target[1] - originP[1], target[2] - originP[2]);
        }
        if (k < num - 1) {
            let tran1 = [];
            let tran2 = [];
            this.externalRenderers.toRenderCoordinates(view, [vertices[k][0], vertices[k][1], depth], 0, view.spatialReference, tran1, 0, 1);
            this.externalRenderers.toRenderCoordinates(view, [vertices[k + 1][0], vertices[k + 1][1], depth], 0, view.spatialReference, tran2, 0, 1);
            vector3List.push(tran1[0], tran1[1], tran1[2], centerP[0], centerP[1], centerP[2], tran2[0], tran2[1], tran2[2]);
            const line = new this.Polyline({
                paths: [[vertices[k][0], vertices[k][1], vertices[k][2]], [vertices[k + 1][0], vertices[k + 1][1], vertices[k + 1][2]]],
                spatialReference: view.spatialReference,
            });
            const desGeo = this.geometryEngine.densify(line, 10);
            if (view.map.ground.layers.items.length > 0) {
                let hLayer = view.map.ground.layers.items[0];
                hLayer.queryElevation(desGeo).then(function (res) {
                    //创建三角面
                    that.createSideGeometry(res.geometry.paths[0].concat(), true);
                });
            } else {
                that.createSideGeometry(line.paths[0], false);
            }
        } else if (k == num - 1) {
            let tran1 = [];
            let tran2 = [];
            this.externalRenderers.toRenderCoordinates(view, [vertices[k][0], vertices[k][1], depth], 0, view.spatialReference, tran1, 0, 1);
            this.externalRenderers.toRenderCoordinates(view, [vertices[0][0], vertices[0][1], depth], 0, view.spatialReference, tran2, 0, 1);
            vector3List.push(tran1[0], tran1[1], tran1[2], centerP[0], centerP[1], centerP[2], tran2[0], tran2[1], tran2[2]);
            const line = new this.Polyline({
                //hasZ: true,
                paths: [[vertices[k][0], vertices[k][1], vertices[k][2]], [vertices[0][0], vertices[0][1], vertices[0][2]]],
                spatialReference: view.spatialReference,
            });
            const desGeo = this.geometryEngine.densify(line, 10);
            if (view.map.ground.layers.items.length > 0) {
                let hLayer = view.map.ground.layers.items[0];
                hLayer.queryElevation(desGeo).then(function (res) {
                    //创建三角面
                    that.createSideGeometry(res.geometry.paths[0].concat(), true);
                });
            } else {
                that.createSideGeometry(line.paths[0], false);
            }
        }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vector3List), 3));
    var texture = new THREE.TextureLoader().load(
        'assets/dz.png'
    );
    const material = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: texture,
    });
    const mesh = new THREE.Mesh(geometry.clone(), material);
    this.scene.add(mesh);

    let cutInfo=new Object();
    cutInfo.origin=originP;
    cutInfo.points=array;
    cutInfo.num=num;
    this.cutPlanes.push(cutInfo);
    let plane = new Object();
    plane.basis1 = [0.01, 0, 0];
    plane.basis2 = [0, 0.01, 0];
    plane.origin = originP;
    plane.plane = [0, 0, 1, 0];
    plane.polygon = this.cutPlanes;
    // plane.num = num;
    // plane.depth = depth;
    this.slice = new this.SliceViewModel({
        view: view,
    });
    this.slice.excludedLayers.addMany(view.map.layers.items);
    this.slice.startCut(plane);
    if(this.cutPlanes.length>=this.polygonMaxNum){
        this.cutPlanes=[];
    }
}
GroundLayer.prototype.createSideGeometry = function (coordsArray, elevation) {
    let Points = coordsArray.concat();
    // 计算顶点
    let transform = new THREE.Matrix4(); // 变换矩阵
    const num = Points.length;
    let transformation = new Array(16);
    let vector3List = [];
    let faceList = [];
    let faceVertexUvs = [];
    // 转换顶点坐标
    Points.forEach((Point) => {
        let _height = elevation ? Point[2] : 0;
        transform.fromArray(
            this.externalRenderers.renderCoordinateTransformAt(
                view,
                [Point[0], Point[1], _height],
                view.spatialReference,
                transformation
            )
        );
        vector3List.push(
            new THREE.Vector3(
                transform.elements[12],
                transform.elements[13],
                transform.elements[14]
            )
        );
        transform.fromArray(
            this.externalRenderers.renderCoordinateTransformAt(
                view,
                [Point[0], Point[1], depth],
                view.spatialReference,
                transformation
            )
        );
        vector3List.push(
            new THREE.Vector3(
                transform.elements[12],
                transform.elements[13],
                transform.elements[14]
            )
        );
    });

    // 纹理坐标
    const t0 = new THREE.Vector2(0, 0);
    const t1 = new THREE.Vector2(1, 0);
    const t2 = new THREE.Vector2(1, 1);
    const t3 = new THREE.Vector2(0, 1);
    // 生成几何体三角面
    for (let i = 0; i < vector3List.length - 2; i++) {
        if (i % 2 === 0) {
            faceList.push(new THREE.Face3(i, i + 2, i + 1));
            faceVertexUvs.push([t0, t1, t3]);
        } else {
            faceList.push(new THREE.Face3(i, i + 1, i + 2));
            faceVertexUvs.push([t3, t1, t2]);
        }
    }
    // 几何体
    const geometry = new THREE.Geometry();
    geometry.vertices = vector3List;
    geometry.faces = faceList;
    geometry.faceVertexUvs[0] = faceVertexUvs;
    var texture = new THREE.TextureLoader().load(
        'assets/dz2.png'
    );
    // 设置纹理旋转角度
    texture.rotation = Math.PI / 2;
    const material = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        map: texture,
    });
    const mesh = new THREE.Mesh(geometry.clone(), material);
    this.scene.add(mesh);
}