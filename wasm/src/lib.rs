//! Scratch hologram: perspective camera rays intersect a finite metal disc.
//! Circular, cylindrical grooves encode a sparse virtual scene. A filtered
//! cross-section BRDF integrates unresolved groove normals (geometric optics).
//! No animated texture, projected hidden object, or wavelength-based colouring.
use std::cell::RefCell;
use std::f32::consts::PI;

const GRID: usize = 64;
const EXTENT: f32 = 1.08;
const SPAN: f32 = 0.50; // +/- 28.6 degrees of each physically fixed circular arc
const WIDTH: f32 = 0.0022;
const CAMERA_DISTANCE: f32 = 4.2;
const LIGHT_DISTANCE: f32 = 4.0;
const NOMINAL_CAMERA_ELEVATION: f32 = 20.0;
const NOMINAL_LIGHT_ELEVATION: f32 = 55.0;

type V = [f32; 3];
fn add(a: V, b: V) -> V { [a[0]+b[0],a[1]+b[1],a[2]+b[2]] }
fn sub(a: V, b: V) -> V { [a[0]-b[0],a[1]-b[1],a[2]-b[2]] }
fn mul(a: V, k: f32) -> V { [a[0]*k,a[1]*k,a[2]*k] }
fn dot(a: V, b: V) -> f32 { a[0]*b[0]+a[1]*b[1]+a[2]*b[2] }
fn length(a: V) -> f32 { dot(a,a).sqrt() }
fn unit(a: V) -> V { mul(a,1.0/length(a).max(1e-9)) }
fn cross(a: V, b: V) -> V { [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]] }
fn orbit(az: f32, el: f32, distance: f32) -> V {
    let a=az.to_radians(); let e=el.to_radians();
    [distance*a.sin()*e.cos(),distance*e.sin(),distance*a.cos()*e.cos()]
}
fn reflect(l: V, n: V) -> V { sub(mul(n,2.0*dot(n,l)),l) }

#[derive(Clone, Copy)]
#[allow(dead_code)]
struct Scratch { cx:f32, cy:f32, radius:f32, nx:f32, ny:f32, point:V }
impl Scratch {
    fn position(&self, angle:f32) -> V {
        let a=self.nx.atan2(self.ny)+angle;
        [self.cx+self.radius*a.sin(),self.cy+self.radius*a.cos(),0.0]
    }
}
struct Engine {
    width:usize, height:usize, pixels:Vec<u8>, scratches:Vec<Scratch>,
    cells:Vec<Vec<usize>>, geometry:Vec<f32>, active:u32,
}
impl Engine {
    fn new() -> Self { Self { width:1,height:1,pixels:vec![0;4],scratches:vec![],cells:vec![vec![];GRID*GRID],geometry:vec![],active:0 } }
    fn encode(&mut self, shape:u32, depth:f32, density:f32) {
        let depth=depth.clamp(0.15,1.8);
        let density=density.clamp(0.5,2.0);
        let mut points:Vec<V>=vec![];
        match shape {
            1 => { // a spatial double helix
                let steps=(180.0*density).round().max(24.0) as usize;
                for i in 0..steps {
                    let t=i as f32/(steps.saturating_sub(1).max(1)) as f32;
                    let a=t*PI*4.0;
                    for k in 0..2 {
                        let b=a+k as f32*PI;
                        points.push([b.cos()*0.30,(t-0.5)*0.85-0.08,-(0.46+b.sin()*0.20)*depth]);
                    }
                    let cross_step=(12.0/density).round().max(1.0) as usize;
                    if i%cross_step==0 {
                        for j in 1..10 { let b=j as f32/10.0; points.push([a.cos()*0.30*(1.0-2.0*b),(t-0.5)*0.85-0.08,-(0.46+a.sin()*0.20*(1.0-2.0*b))*depth]); }
                    }
                }
            }
            2 => { // one groove: useful for inspecting the reflection condition
                points.push([0.0,-0.16,-0.46*depth]);
            }
            _ => {
                let mut vertices=vec![];
                for z in [-1.0,1.0] { for y in [-1.0,1.0] { for x in [-1.0,1.0] {
                    let (s,c)=0.40f32.sin_cos();
                    let rx=x*c+z*s; let rz=-x*s+z*c;
                    let (s2,c2)=0.18f32.sin_cos();
                    let ry=y*c2-rz*s2; let rz2=y*s2+rz*c2;
                    vertices.push([rx*0.28,ry*0.28-0.12,-(0.46+rz2*0.19)*depth]);
                } } }
                for i in 0usize..8 { for j in i+1..8 {
                    if (i^j).count_ones()==1 {
                        let edge_steps=(22.0*density).round().max(4.0) as usize;
                        for k in 0..edge_steps { let t=k as f32/edge_steps as f32; points.push(add(mul(vertices[i],1.0-t),mul(vertices[j],t))); }
                    }
                } }
            }
        }
        self.encode_points(&points);
    }

    fn encode_points(&mut self, points:&[V]) {
        // Every new pattern replaces ALL geometry, including the cell index.
        // Both presets and SVG imports must enter through this function.
        self.scratches.clear();
        self.geometry.clear();
        let light=orbit(0.0,NOMINAL_LIGHT_ELEVATION,LIGHT_DISTANCE);
        let camera=orbit(0.0,NOMINAL_CAMERA_ELEVATION,CAMERA_DISTANCE);
        for point in points.iter().copied() {
            let surface=project_to_plate(point,camera);
            let h=add(unit(sub(light,surface)),unit(sub(camera,surface)));
            let n=unit([h[0],h[1],0.0]);
            // Fit a circle to the ideal normal field at the design view.
            // This enforces first-order horizontal parallax, even for finite
            // camera/light distance. Wider views retain circular-arc distortion.
            let cp=orbit(0.10,NOMINAL_CAMERA_ELEVATION,CAMERA_DISTANCE);
            let cm=orbit(-0.10,NOMINAL_CAMERA_ELEVATION,CAMERA_DISTANCE);
            let qp=project_to_plate(point,cp); let qm=project_to_plate(point,cm);
            let hp=add(unit(sub(light,qp)),unit(sub(cp,qp)));
            let hm=add(unit(sub(light,qm)),unit(sub(cm,qm)));
            let dn=sub(unit([hp[0],hp[1],0.0]),unit([hm[0],hm[1],0.0]));
            let radius=(dot(sub(qp,qm),dn)/dot(dn,dn).max(1e-9)).clamp(0.04,4.0);
            let s=Scratch {cx:surface[0]-radius*n[0],cy:surface[1]-radius*n[1],radius,nx:n[0],ny:n[1],point};
            self.geometry.extend_from_slice(&[s.cx,s.cy,s.radius,s.nx,s.ny,point[0],point[1],point[2]]);
            self.scratches.push(s);
        }
        self.cells=vec![vec![];GRID*GRID];
        for (index,s) in self.scratches.iter().enumerate() {
            let steps=(s.radius*SPAN*2.0/0.008).ceil().max(24.0) as usize;
            for i in 0..=steps {
                let p=s.position(-SPAN+2.0*SPAN*i as f32/steps as f32);
                let gx=grid_coord(p[0]); let gy=grid_coord(p[1]);
                for dy in -1..=1 { for dx in -1..=1 {
                    let x=gx+dx; let y=gy+dy;
                    if x>=0 && y>=0 && x<GRID as i32 && y<GRID as i32 {
                        let cell=&mut self.cells[y as usize*GRID+x as usize];
                        if cell.last().copied()!=Some(index) { cell.push(index); }
                    }
                } }
            }
        }
    }

    fn encode_custom(&mut self, raw:&[f32], depth:f32) {
        let mut points=Vec::with_capacity(raw.len()/3);
        for chunk in raw.chunks_exact(3) {
            if chunk.iter().all(|value| value.is_finite()) {
                points.push([chunk[0].clamp(-0.82,0.82), chunk[1].clamp(-0.82,0.82), (chunk[2]*depth.clamp(0.15,1.8)).clamp(-1.8,-0.05)]);
            }
        }
        self.encode_points(&points);
    }
    fn shade(&self, p:V, camera:V, light:V, sigma:f32, engraving:bool, footprint:f32) -> V {
        let r=(p[0]*p[0]+p[1]*p[1]).sqrt();
        let l=unit(sub(light,p)); let v=unit(sub(camera,p));
        let h=unit(add(l,v));
        let distance=length(sub(light,p));
        let attenuation=(LIGHT_DISTANCE/distance).powi(2);
        let grain=(((p[0]*734.0).sin()*(p[1]*971.0).cos())*0.5+0.5)*0.0035;
        let flat_spec=(-(1.0-dot(reflect(l,[0.0,0.0,1.0]),v))/(0.018f32.powi(2))).exp();
        let vinyl=((p[0]*420.0).sin()*0.5+0.5)*0.0012;
        let mut color=[0.018+vinyl+grain+flat_spec*0.055,0.020+vinyl+grain+flat_spec*0.06,0.023+vinyl+grain+flat_spec*0.065];
        let gx=grid_coord(p[0]); let gy=grid_coord(p[1]);
        let support=WIDTH+footprint*0.55;
        let mut lines=0.0; let mut specular=0.0;
        if gx>=0 && gy>=0 && gx<GRID as i32 && gy<GRID as i32 {
            for &id in &self.cells[gy as usize*GRID+gx as usize] {
                let s=&self.scratches[id];
                let dx=p[0]-s.cx; let dy=p[1]-s.cy;
                let rr=(dx*dx+dy*dy).sqrt();
                let d=(rr-s.radius).abs();
                if d>support || rr<1e-6 { continue; }
                let nx=dx/rr; let ny=dy/rr;
                if nx*s.nx+ny*s.ny<SPAN.cos() { continue; }
                let coverage=(1.0-d/support).max(0.0)*(WIDTH/support);
                lines+=coverage;
                // A smooth cylindrical cross-section has a continuum of
                // normals perpendicular to the groove tangent. Integrating
                // these subpixel normals avoids missing a narrow real glint.
                let tangent=[ny,-nx,0.0];
                let normal=unit(sub(h,mul(tangent,dot(h,tangent))));
                if normal[2]<0.12 || dot(normal,l)<=0.0 { continue; }
                let reflection=reflect(l,normal);
                let mismatch=(1.0-dot(reflection,v)).max(0.0);
                let response=(-mismatch/(sigma*sigma*0.5)).exp();
                // Constant source energy: increasing angular extent spreads
                // the lobe and lowers the peak instead of adding extra light.
                specular+=coverage*response*(0.018/sigma).sqrt()*dot(normal,l)*attenuation;
            }
        }
        if engraving {
            let c=lines.min(1.0);
            color=add(color,mul([0.35,0.37,0.39],c));
        } else {
            color=add(color,mul([0.008,0.010,0.012],lines.min(2.0)));
            color=add(color,mul([1.00,0.96,0.87],specular*3.5));
        }
        if r>0.982 { // rounded outer rim
            let a=((r-0.982)/0.018).clamp(0.0,1.0)*1.25;
            let normal=unit([p[0]/r*a.sin(),p[1]/r*a.sin(),a.cos()]);
            let rim=dot(normal,h).max(0.0).powf(40.0)*0.32+0.01;
            color=add(color,[rim,rim*0.98,rim*0.93]);
        }
        color
    }
    fn trace(&self, origin:V, ray:V, light:V, sigma:f32, engraving:bool, footprint:f32) -> (V,bool) {
        let t=-origin[2]/ray[2];
        if t>0.0 {
            let p=add(origin,mul(ray,t));
            if p[0]*p[0]+p[1]*p[1]<=1.0 { return (self.shade(p,origin,light,sigma,engraving,footprint),true); }
        }
        // Exact ray-cylinder intersection for the finite thickness of the rim.
        let a=ray[0]*ray[0]+ray[1]*ray[1];
        let b=2.0*(origin[0]*ray[0]+origin[1]*ray[1]);
        let c=origin[0]*origin[0]+origin[1]*origin[1]-1.0;
        let discriminant=b*b-4.0*a*c;
        if a>1e-8 && discriminant>0.0 {
            let root=discriminant.sqrt();
            for tt in [(-b-root)/(2.0*a),(-b+root)/(2.0*a)] {
                if tt<=0.0 { continue; }
                let p=add(origin,mul(ray,tt));
                if p[2]>=-0.045 && p[2]<0.0 {
                    let n=unit([p[0],p[1],0.0]);
                    let h=unit(add(unit(sub(light,p)),unit(sub(origin,p))));
                    let k=dot(n,h).max(0.0).powf(24.0)*0.45+0.025;
                    return ([k,k*0.95,k*0.87],true);
                }
            }
        }
        // Studio backing plane and an actual visibility/shadow ray to the LED.
        let tg=(-0.20-origin[2])/ray[2];
        let p=add(origin,mul(ray,tg.max(0.0)));
        let to_light=sub(light,p);
        let at=-p[2]/to_light[2];
        let blocked=add(p,mul(to_light,at));
        let shadow=at>0.0 && at<1.0 && blocked[0]*blocked[0]+blocked[1]*blocked[1]<1.0;
        // Keep the camera field pure black: the disc is the only rendered
        // object, so the demo reads as a floating optical plate.
        let _ = (shadow, p);
        ([0.0,0.0,0.0],false)
    }
    fn render(&mut self, az:f32, el:f32, laz:f32, lel:f32, source_size:f32, mode:u32) -> *const u8 {
        let camera=orbit(az.clamp(-70.0,70.0),el.clamp(-60.0,65.0),CAMERA_DISTANCE);
        let light=orbit(laz.clamp(-80.0,80.0),lel.clamp(-70.0,80.0),LIGHT_DISTANCE);
        let forward=unit(mul(camera,-1.0));
        let right=unit(cross(forward,[0.0,1.0,0.0]));
        let up=unit(cross(right,forward));
        let fov=(34.0f32.to_radians()*0.5).tan();
        let aspect=self.width as f32/self.height as f32;
        let footprint=2.0*CAMERA_DISTANCE*fov/self.height as f32;
        let sigma=(0.35+source_size.clamp(0.0,8.0)*0.50).to_radians();
        let mut active=0;
        for y in 0..self.height { for x in 0..self.width {
            let sx=(2.0*(x as f32+0.5)/self.width as f32-1.0)*aspect*fov;
            let sy=(1.0-2.0*(y as f32+0.5)/self.height as f32)*fov;
            let ray=unit(add(forward,add(mul(right,sx),mul(up,sy))));
            let (color,hit)=self.trace(camera,ray,light,sigma,mode==1,footprint);
            if hit { active+=1; }
            let i=(y*self.width+x)*4;
            for (j,v) in color.iter().enumerate() {
                // Filmic exposure and sRGB-like output conversion.
                let exposed=(v*1.75).max(0.0);
                let mapped=exposed/(1.0+exposed);
                self.pixels[i+j]=(mapped.powf(1.0/2.2)*255.0).clamp(0.0,255.0) as u8;
            }
            self.pixels[i+3]=255;
        } }
        self.active=active;
        self.pixels.as_ptr()
    }
}
fn grid_coord(x:f32)->i32 { ((x+EXTENT)/(2.0*EXTENT)*GRID as f32).floor() as i32 }
fn project_to_plate(p:V,c:V)->V { add(p,mul(sub(c,p),-p[2]/(c[2]-p[2]))) }

thread_local! { static ENGINE:RefCell<Engine>=RefCell::new(Engine::new()); }

#[no_mangle] pub extern "C" fn init(width:u32,height:u32) {
    ENGINE.with(|e| {let mut e=e.borrow_mut(); e.width=width.clamp(160,1920) as usize; e.height=height.clamp(120,1440) as usize; e.pixels=vec![0;e.width*e.height*4];});
}
#[no_mangle] pub extern "C" fn alloc(len:usize)->*mut f32 { let mut buffer=Vec::<f32>::with_capacity(len); let ptr=buffer.as_mut_ptr(); std::mem::forget(buffer); ptr }
#[no_mangle] pub unsafe extern "C" fn dealloc(ptr:*mut f32,len:usize) { if !ptr.is_null() { drop(Vec::from_raw_parts(ptr,len,len)); } }
#[no_mangle] pub extern "C" fn configure(shape:u32,depth:f32,density:f32) { ENGINE.with(|e|e.borrow_mut().encode(shape,depth,density)); }
#[no_mangle] pub unsafe extern "C" fn configure_points(ptr:*const f32,count:usize,depth:f32) { if ptr.is_null() { return; } let raw=std::slice::from_raw_parts(ptr,count*3); ENGINE.with(|e|e.borrow_mut().encode_custom(raw,depth)); }
#[no_mangle] pub extern "C" fn render(az:f32,el:f32,laz:f32,lel:f32,size:f32,mode:u32)->*const u8 { ENGINE.with(|e|e.borrow_mut().render(az,el,laz,lel,size,mode)) }
#[no_mangle] pub extern "C" fn scratch_count()->u32 { ENGINE.with(|e|e.borrow().scratches.len() as u32) }
#[no_mangle] pub extern "C" fn geometry_ptr()->*const f32 { ENGINE.with(|e|e.borrow().geometry.as_ptr()) }
#[no_mangle] pub extern "C" fn active_pixels()->u32 { ENGINE.with(|e|e.borrow().active) }
#[no_mangle] pub extern "C" fn arc_span()->f32 { SPAN }

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn mirror_reflection_obeys_law() {
        let n=unit([0.0,0.6,0.8]); let l=unit([0.3,0.5,1.0]); let r=reflect(l,n);
        assert!((dot(n,l)-dot(n,r)).abs()<1e-6);
        assert!((length(r)-1.0).abs()<1e-6);
    }
    #[test] fn encoded_circle_matches_reference_reflection() {
        let mut e=Engine::new();e.encode(0,1.0,1.0);
        let camera=orbit(0.0,20.0,CAMERA_DISTANCE);let light=orbit(0.0,55.0,LIGHT_DISTANCE);
        for s in &e.scratches {
            let q=s.position(0.0);let target=project_to_plate(s.point,camera);
            assert!(length(sub(q,target))<1e-5);
            let h=unit(add(unit(sub(light,q)),unit(sub(camera,q))));
            let tangent=[s.ny,-s.nx,0.0];
            assert!(dot(h,tangent).abs()<1e-5);
            assert!(dot(reflect(unit(sub(light,q)),h),unit(sub(camera,q)))>0.9999);
        }
    }
    #[test] fn near_view_parallax_matches_virtual_point() {
        let mut e=Engine::new(); e.encode(0,1.0,1.0);
        let camera=orbit(0.2,20.0,CAMERA_DISTANCE);let light=orbit(0.0,55.0,LIGHT_DISTANCE);
        for s in &e.scratches {
            let expected=project_to_plate(s.point,camera);
            let mut q=s.position(0.0);
            for _ in 0..24 {
                let h=unit(add(unit(sub(light,q)),unit(sub(camera,q))));
                let n=unit([h[0],h[1],0.0]);
                q=[s.cx+s.radius*n[0],s.cy+s.radius*n[1],0.0];
            }
            assert!((q[0]-expected[0]).abs()<0.0001,"horizontal parallax error");
        }
    }
    #[test] fn ray_tracer_has_disc_and_background() {
        let mut e=Engine::new();e.width=160;e.height=120;e.pixels=vec![0;160*120*4];e.encode(0,1.0,1.0);
        e.render(0.0,20.0,0.0,55.0,0.8,0);
        assert!(e.active>1000 && e.active<160*120);
        assert!(e.pixels.iter().skip(3).step_by(4).all(|a|*a==255));
        let initial=e.pixels.clone();e.render(0.0,20.0,30.0,55.0,0.8,0);
        assert_ne!(initial,e.pixels);
    }
}
