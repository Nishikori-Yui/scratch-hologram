//! Scratch hologram: perspective camera rays intersect a finite metal disc.
//! Circular, cylindrical grooves encode a sparse virtual scene. A filtered
//! cross-section BRDF integrates unresolved groove normals (geometric optics).
//! No animated texture, projected hidden object, or wavelength-based colouring.
use std::cell::RefCell;
use std::f32::consts::PI;

const GRID: usize = 64;
const EXTENT: f32 = 1.08;
const SPAN: f32 = 0.50; // +/- 28.6 degrees of each physically fixed circular arc
const ROTARY_SPAN: f32 = 0.035;
const WIDTH: f32 = 0.0022;
const CAMERA_DISTANCE: f32 = 4.2;
const LIGHT_DISTANCE: f32 = 4.0;
const BACKING_PLANE_Z: f32 = -0.32;
const DISC_THICKNESS: f32 = 0.045;
const WALL_LIGHT_RADIUS: f32 = 1.80;
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
struct DiscPose { x:V, y:V, normal:V }
impl DiscPose {
    fn new(az:f32, el:f32) -> Self {
        let (sa,ca)=az.clamp(-35.0,35.0).to_radians().sin_cos();
        let (se,ce)=el.clamp(-35.0,35.0).to_radians().sin_cos();
        Self { x:[ca,0.0,-sa], y:[-sa*se,ce,-ca*se], normal:[sa*ce,se,ca*ce] }
    }
    fn local(&self, p:V) -> V { [dot(p,self.x),dot(p,self.y),dot(p,self.normal)] }
    fn spun(self, degrees:f32) -> Self {
        let (s,c)=degrees.to_radians().sin_cos();
        Self { x:add(mul(self.x,c),mul(self.y,s)), y:add(mul(self.x,-s),mul(self.y,c)), normal:self.normal }
    }
    #[cfg(test)]
    fn world(&self, p:V) -> V { add(mul(self.x,p[0]),add(mul(self.y,p[1]),mul(self.normal,p[2]))) }
    fn wall_z(&self) -> f32 {
        // The furthest tilted rim stays at least 0.12 units in front of the wall.
        let tilt=(1.0-self.normal[2]*self.normal[2]).max(0.0).sqrt();
        -(-BACKING_PLANE_Z).max(tilt+DISC_THICKNESS+0.12)
    }
}
fn filtered_wave(coordinate:f32, frequency:f32, footprint:f32) -> f32 {
    (coordinate*frequency).cos()*(-0.5*(frequency*footprint).powi(2)).exp()
}
fn vinyl_wave(radius:f32, frequency:f32, footprint:f32) -> f32 {
    // Integrate fine rings over the pixel width; suppress unresolved detail.
    let phase=frequency*footprint*0.5;
    if phase>=PI*0.5 { return 0.0; }
    let coverage=if phase<1e-4 {1.0} else {phase.sin()/phase};
    let fade=((phase/(PI*0.5)-0.65)/0.35).clamp(0.0,1.0);
    (radius*frequency).cos()*coverage*(1.0-fade*fade*(3.0-2.0*fade))
}
fn anisotropic_lobe(h:V, along:V, across:V, rough_along:f32, rough_across:f32) -> f32 {
    if h[2]<=0.0 { return 0.0; }
    let a=dot(h,along)/(rough_along*h[2]);
    let b=dot(h,across)/(rough_across*h[2]);
    (-(a*a+b*b)).exp()
}
fn vinyl_normal(p:V, base:V, footprint:f32) -> V {
    // The record surface uses filtered procedural micro-grooves. They change
    // the shading normal only; no extra groove geometry is allocated.
    let r=(p[0]*p[0]+p[1]*p[1]).sqrt();
    let wave=vinyl_wave(r,320.0,footprint)*0.002+vinyl_wave(r,900.0,footprint)*0.008+vinyl_wave(r,1800.0,footprint)*0.0025;
    let radial=unit([p[0],p[1],0.0]);
    unit([base[0]-radial[0]*wave,base[1]-radial[1]*wave,base[2]])
}

#[derive(Clone, Copy)]
#[allow(dead_code)]
struct Scratch { cx:f32, cy:f32, radius:f32, nx:f32, ny:f32, point:V, facet_slope:f32 }
impl Scratch {
    fn position(&self, angle:f32) -> V {
        let a=self.nx.atan2(self.ny)+angle;
        [self.cx+self.radius*a.sin(),self.cy+self.radius*a.cos(),0.0]
    }
}
struct Engine {
    width:usize, height:usize, pixels:Vec<u8>, scratches:Vec<Scratch>,
    cells:Vec<Vec<usize>>, geometry:Vec<f32>, active:u32, disc:DiscPose, material:u32, rotary:bool,
    gpu_scratches:Vec<f32>, cell_offsets:Vec<u32>, cell_indices:Vec<u32>,
}
impl Engine {
    fn new() -> Self { Self { width:1,height:1,pixels:vec![0;4],scratches:vec![],cells:vec![vec![];GRID*GRID],geometry:vec![],active:0,disc:DiscPose::new(0.0,0.0),material:0,rotary:false,gpu_scratches:vec![],cell_offsets:vec![],cell_indices:vec![] } }
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
        self.rotary=false;
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
            let s=Scratch {cx:surface[0]-radius*n[0],cy:surface[1]-radius*n[1],radius,nx:n[0],ny:n[1],point,facet_slope:0.0};
            self.geometry.extend_from_slice(&[s.cx,s.cy,s.radius,s.nx,s.ny,point[0],point[1],point[2]]);
            self.scratches.push(s);
        }
        self.index_scratches();
    }
    fn span(&self) -> f32 { if self.rotary { ROTARY_SPAN } else { SPAN } }
    fn index_scratches(&mut self) {
        self.cells=vec![vec![];GRID*GRID];
        let span=self.span();
        for (index,s) in self.scratches.iter().enumerate() {
            let steps=(s.radius*span*2.0/0.008).ceil().max(if self.rotary {8.0} else {24.0}) as usize;
            for i in 0..=steps {
                let p=s.position(-span+2.0*span*i as f32/steps as f32);
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
        self.gpu_scratches.clear();
        for s in &self.scratches {
            self.gpu_scratches.extend_from_slice(&[s.cx,s.cy,s.radius,s.nx,s.ny,s.facet_slope,0.0,0.0]);
        }
        self.cell_offsets.clear(); self.cell_indices.clear();
        for cell in &self.cells {
            self.cell_offsets.push(self.cell_indices.len() as u32);
            self.cell_indices.extend(cell.iter().map(|&id| id as u32));
        }
        self.cell_offsets.push(self.cell_indices.len() as u32);
    }

    fn encode_rotary(&mut self, raw:&[f32], depth:f32) {
        self.scratches.clear(); self.geometry.clear(); self.rotary=true;
        let camera=orbit(0.0,0.0,CAMERA_DISTANCE);
        let light=orbit(0.0,35.0,LIGHT_DISTANCE);
        for sample in raw.chunks_exact(4) {
            if !sample.iter().all(|v| v.is_finite()) { continue; }
            let point=[sample[0],sample[1],(sample[2]*depth.clamp(0.15,1.8)).clamp(-1.8,-0.05)];
            let surface=project_to_plate(point,camera);
            let h=add(unit(sub(light,surface)),unit(sub(camera,surface)));
            let n=unit([h[0],h[1],0.0]);
            let radius=(-point[2]*0.85).clamp(0.08,1.5);
            let pose=DiscPose::new(0.0,0.0).spun(sample[3]);
            let center=pose.local(sub(surface,mul(n,radius)));
            let normal=pose.local(n);
            let slope=(h[0]*h[0]+h[1]*h[1]).sqrt()/h[2].max(1e-5);
            let s=Scratch { cx:center[0],cy:center[1],radius,nx:normal[0],ny:normal[1],point,facet_slope:slope };
            self.geometry.extend_from_slice(&[s.cx,s.cy,s.radius,s.nx,s.ny,point[0],point[1],point[2]]);
            self.scratches.push(s);
        }
        self.index_scratches();
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
        let incidence=l[2].max(0.0)*attenuation;
        let mut color=if self.material==0 {
            let radial=unit([p[0],p[1],0.0]);
            let tangent=[-radial[1],radial[0],0.0];
            let rings=vinyl_wave(r,320.0,footprint)*0.25+vinyl_wave(r,900.0,footprint)*0.65+vinyl_wave(r,1800.0,footprint)*0.1;
            let h=vinyl_normal(p,h,footprint);
            let sheen=anisotropic_lobe(h,tangent,radial,0.045,0.34);
            let base=0.0016+(0.0007+0.0012*rings)*incidence;
            let highlight=0.048*sheen*incidence*(0.78+0.22*rings);
            [base+highlight,base+highlight,base*1.04+highlight]
        } else {
            let brush=filtered_wave(p[1],180.0,footprint)*0.7+filtered_wave(p[1],930.0,footprint)*0.3;
            let sheen=anisotropic_lobe(h,[1.0,0.0,0.0],[0.0,1.0,0.0],0.09,0.46);
            let base=0.035+(0.085+0.009*brush)*incidence;
            let highlight=0.38*sheen*incidence*(0.9+0.1*brush);
            [base+highlight,base*1.02+highlight,base*1.04+highlight]
        };
        let gx=grid_coord(p[0]); let gy=grid_coord(p[1]);
        let support=WIDTH+footprint*0.55;
        let arc_cos=self.span().cos();
        let mut lines=0.0; let mut specular=0.0;
        if gx>=0 && gy>=0 && gx<GRID as i32 && gy<GRID as i32 {
            for &id in &self.cells[gy as usize*GRID+gx as usize] {
                let s=&self.scratches[id];
                let dx=p[0]-s.cx; let dy=p[1]-s.cy;
                let rr2=dx*dx+dy*dy;
                if rr2>(s.radius+support).powi(2) || rr2<(s.radius-support).max(0.0).powi(2) { continue; }
                let along=dx*s.nx+dy*s.ny;
                if along<0.0 || along*along<rr2*arc_cos*arc_cos { continue; }
                let rr=rr2.sqrt();
                let d=(rr-s.radius).abs();
                if d>support || rr<1e-6 { continue; }
                let nx=dx/rr; let ny=dy/rr;
                if nx*s.nx+ny*s.ny<arc_cos { continue; }
                let coverage=(1.0-d/support).max(0.0)*(WIDTH/support);
                lines+=coverage;
                // A smooth cylindrical cross-section has a continuum of
                // normals perpendicular to the groove tangent. Integrating
                // these subpixel normals avoids missing a narrow real glint.
                let tangent=[ny,-nx,0.0];
                // The rotary plate uses a fixed bevel, rather than a cylinder
                // containing every slope. Its facet turns with the engraving.
                let normal=if self.rotary {
                    unit([nx*s.facet_slope,ny*s.facet_slope,1.0])
                } else { unit(sub(h,mul(tangent,dot(h,tangent)))) };
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
            if self.material==0 {
                color=add(color,mul([0.002,0.002,0.002],lines.min(2.0)));
            } else {
                color=mul(color,1.0-lines.min(1.0)*0.28);
            }
            color=add(color,mul([1.00,0.96,0.87],specular*3.5));
        }
        if r>0.982 { // rounded outer rim
            let a=((r-0.982)/0.018).clamp(0.0,1.0)*1.25;
            let normal=unit([p[0]/r*a.sin(),p[1]/r*a.sin(),a.cos()]);
            let rim=dot(normal,h).max(0.0).powf(40.0);
            let strength=if self.material==0 {0.018} else {0.22};
            color=add(color,mul([1.0,1.0,1.0],rim*strength));
        }
        color
    }
    fn trace(&self, origin:V, ray:V, light:V, sigma:f32, engraving:bool, footprint:f32) -> (V,u8) {
        let local_origin=self.disc.local(origin);
        let local_ray=self.disc.local(ray);
        let local_light=self.disc.local(light);
        if let Some(color)=self.trace_disc(local_origin,local_ray,local_light,sigma,engraving,footprint) {
            return (color,255);
        }
        let wall_z=self.disc.wall_z();
        let tg=(wall_z-origin[2])/ray[2];
        if tg<=0.0 { return ([0.0,0.0,0.0],0); }
        let p=add(origin,mul(ray,tg));
        let to_light=sub(light,p);
        let light_distance=length(to_light).max(1e-5);
        let incidence=(to_light[2]/light_distance).max(0.0);
        if incidence<=0.0 || light[2]<=0.01 { return ([0.0,0.0,0.0],0); }
        let local_p=self.disc.local(p);
        let local_to_light=self.disc.local(to_light);
        let at=-local_p[2]/local_to_light[2];
        let softness=(0.04+sigma*(-wall_z)*6.0).clamp(0.04,0.24);
        let visibility=if at>0.0 && at<1.0 {
            let blocked=add(local_p,mul(local_to_light,at));
            let radius=(blocked[0]*blocked[0]+blocked[1]*blocked[1]).sqrt();
            let edge=((radius-1.0+softness)/(2.0*softness)).clamp(0.0,1.0);
            edge*edge*(3.0-2.0*edge)
        } else { 1.0 };
        // A broad light footprint on the wall is independent of the disc outline.
        let beam_center=mul(light,wall_z/light[2]);
        let wall_radius=length(sub(p,beam_center));
        let beam_radius=WALL_LIGHT_RADIUS+(-wall_z+BACKING_PLANE_Z)*0.15;
        let falloff=(1.0-(wall_radius/beam_radius).powi(2)).clamp(0.0,1.0).powi(2);
        let shadow_alpha=0.22*(1.0-visibility);
        let light_alpha=0.105*incidence*visibility*falloff;
        let alpha=light_alpha+shadow_alpha*(1.0-light_alpha);
        let value=if alpha>0.0 { light_alpha/alpha } else { 0.0 };
        ([value,value,value],(alpha*255.0).round() as u8)
    }
    fn trace_disc(&self, origin:V, ray:V, light:V, sigma:f32, engraving:bool, footprint:f32) -> Option<V> {
        let t=-origin[2]/ray[2];
        if t>0.0 && origin[2]>=0.0 {
            let p=add(origin,mul(ray,t));
            if p[0]*p[0]+p[1]*p[1]<=1.0 { return Some(self.shade(p,origin,light,sigma,engraving,footprint)); }
        }
        let back_t=(-DISC_THICKNESS-origin[2])/ray[2];
        if back_t>0.0 && origin[2]<0.0 {
            let p=add(origin,mul(ray,back_t));
            if p[0]*p[0]+p[1]*p[1]<=1.0 {
                let base=if self.material==0 {0.0016} else {0.065};
                return Some([base,base,base]);
            }
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
                if p[2]>=-DISC_THICKNESS && p[2]<0.0 {
                    let n=unit([p[0],p[1],0.0]);
                    let h=unit(add(unit(sub(light,p)),unit(sub(origin,p))));
                    let rim=dot(n,h).max(0.0).powf(24.0);
                    let k=if self.material==0 {0.0018+rim*0.024} else {0.07+rim*0.36};
                    return Some([k,k,k]);
                }
            }
        }
        None
    }
    fn render(&mut self, az:f32, el:f32, laz:f32, lel:f32, source_size:f32, mode:u32) -> *const u8 {
        let camera=orbit(az.clamp(-70.0,70.0),el.clamp(-60.0,65.0),CAMERA_DISTANCE);
        let light=orbit(laz.clamp(-80.0,80.0),lel.clamp(-70.0,90.0),LIGHT_DISTANCE);
        let forward=unit(mul(camera,-1.0));
        let right=unit(cross(forward,[0.0,1.0,0.0]));
        let up=unit(cross(right,forward));
        let view_angle=50.0+(-self.disc.wall_z()+BACKING_PLANE_Z)*16.0;
        let fov=if self.rotary {0.58/CAMERA_DISTANCE} else {(view_angle.to_radians()*0.5).tan()};
        let aspect=self.width as f32/self.height as f32;
        let footprint=2.0*CAMERA_DISTANCE*fov/self.height as f32;
        let sigma=(0.35+source_size.clamp(0.0,8.0)*0.50).to_radians();
        let mut active=0;
        for y in 0..self.height { for x in 0..self.width {
            let sx=(2.0*(x as f32+0.5)/self.width as f32-1.0)*aspect*fov;
            let sy=(1.0-2.0*(y as f32+0.5)/self.height as f32)*fov+if self.rotary {fov} else {0.0};
            let ray=unit(add(forward,add(mul(right,sx),mul(up,sy))));
            let (color,alpha)=self.trace(camera,ray,light,sigma,mode==1,footprint);
            if alpha==255 { active+=1; }
            let i=(y*self.width+x)*4;
            for (j,v) in color.iter().enumerate() {
                if alpha<255 {
                    // Preserve the straight-alpha wall overlay during export.
                    self.pixels[i+j]=(v*255.0).clamp(0.0,255.0) as u8;
                    continue;
                }
                // Filmic exposure and sRGB-like output conversion.
                let exposed=(v*1.75).max(0.0);
                let mapped=exposed/(1.0+exposed);
                self.pixels[i+j]=(mapped.powf(1.0/2.2)*255.0).clamp(0.0,255.0) as u8;
            }
            self.pixels[i+3]=alpha;
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
#[no_mangle] pub extern "C" fn set_disc(az:f32,el:f32,material:u32) {
    ENGINE.with(|e| {let mut e=e.borrow_mut();e.disc=DiscPose::new(az,el);e.material=material.min(1);});
}
#[no_mangle] pub extern "C" fn set_spin(degrees:f32) {
    ENGINE.with(|e| {let mut e=e.borrow_mut();e.disc=e.disc.spun(degrees);});
}
#[no_mangle] pub unsafe extern "C" fn configure_rotary(ptr:*const f32,count:usize,depth:f32) {
    if ptr.is_null() { return; }
    let raw=std::slice::from_raw_parts(ptr,count*4);
    ENGINE.with(|e|e.borrow_mut().encode_rotary(raw,depth));
}
#[no_mangle] pub unsafe extern "C" fn configure_points(ptr:*const f32,count:usize,depth:f32) { if ptr.is_null() { return; } let raw=std::slice::from_raw_parts(ptr,count*3); ENGINE.with(|e|e.borrow_mut().encode_custom(raw,depth)); }
#[no_mangle] pub extern "C" fn render(az:f32,el:f32,laz:f32,lel:f32,size:f32,mode:u32)->*const u8 { ENGINE.with(|e|e.borrow_mut().render(az,el,laz,lel,size,mode)) }
#[no_mangle] pub extern "C" fn scratch_count()->u32 { ENGINE.with(|e|e.borrow().scratches.len() as u32) }
#[no_mangle] pub extern "C" fn geometry_ptr()->*const f32 { ENGINE.with(|e|e.borrow().geometry.as_ptr()) }
#[no_mangle] pub extern "C" fn active_pixels()->u32 { ENGINE.with(|e|e.borrow().active) }
#[no_mangle] pub extern "C" fn arc_span()->f32 { ENGINE.with(|e|e.borrow().span()) }
#[no_mangle] pub extern "C" fn gpu_scratches_ptr()->*const f32 { ENGINE.with(|e|e.borrow().gpu_scratches.as_ptr()) }
#[no_mangle] pub extern "C" fn cell_offsets_ptr()->*const u32 { ENGINE.with(|e|e.borrow().cell_offsets.as_ptr()) }
#[no_mangle] pub extern "C" fn cell_indices_ptr()->*const u32 { ENGINE.with(|e|e.borrow().cell_indices.as_ptr()) }
#[no_mangle] pub extern "C" fn cell_indices_len()->usize { ENGINE.with(|e|e.borrow().cell_indices.len()) }

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn vinyl_microgrooves_are_radial_and_filter_unresolved_rings() {
        let p=[0.3,0.4,0.0];let h=unit([0.12,0.2,1.0]);
        let n=vinyl_normal(p,h,0.0001);
        let rotated=vinyl_normal([-p[1],p[0],0.0],[-h[1],h[0],h[2]],0.0001);
        for (a,b) in rotated.iter().zip([-n[1],n[0],n[2]]) {
            assert!((a-b).abs()<1e-6,"the same ring must have the same radial normal in every quadrant");
        }
        assert!(vinyl_wave(0.0,900.0,0.0001)>0.99,"resolved fine rings must remain visible");
        assert!(vinyl_wave(0.0,320.0,0.008)>0.2,"standard resolution must retain a resolved ring layer");
        assert_eq!(vinyl_wave(0.0,900.0,0.008),0.0,"unresolved rings must not alias into broad bands");
        let cutoff=PI/900.0;
        assert!(vinyl_wave(0.0,900.0,cutoff*0.999).abs()<0.0001,"texture fades smoothly at the resolution limit");
    }
    #[test] fn rotary_grooves_are_fixed_and_reflect_at_their_encoded_angle() {
        let mut e=Engine::new();
        let raw=[-0.35,0.55,-0.46,0.0,0.3,0.6,-0.46,90.0];
        e.encode_rotary(&raw,1.0);
        let geometry=e.geometry.clone();
        let camera=orbit(0.0,0.0,CAMERA_DISTANCE);
        let light=orbit(0.0,35.0,LIGHT_DISTANCE);
        for (point,angle) in [([-0.35,0.55,-0.46],0.0),([0.3,0.6,-0.46],90.0)] {
            e.disc=DiscPose::new(0.0,0.0).spun(angle);
            let p=e.disc.local(project_to_plate(point,camera));
            let encoded=e.shade(p,e.disc.local(camera),e.disc.local(light),0.013,false,0.002);
            let mut blank=Engine::new(); blank.disc=e.disc;
            let base=blank.shade(p,blank.disc.local(camera),blank.disc.local(light),0.013,false,0.002);
            assert!(encoded[0]>base[0]+0.1,"the encoded point must produce a physical groove reflection");
            e.disc=DiscPose::new(0.0,0.0).spun(angle+45.0);
            let wrong=e.shade(p,e.disc.local(camera),e.disc.local(light),0.013,false,0.002);
            assert!(wrong[0]<encoded[0]*0.1,"a fixed bevel must reject light away from its design angle");
            e.width=160;e.height=120;e.pixels=vec![0;160*120*4];
            e.render(0.0,0.0,0.0,35.0,0.8,0);
            assert_eq!(e.geometry,geometry,"spinning must never rewrite or select a frame's grooves");
        }
        e.encode(2,1.0,1.0);
        assert!(!e.rotary);
        assert_eq!(e.span(),SPAN);
    }
    #[test] fn rotary_view_crops_at_the_spindle_and_keeps_the_upper_rim() {
        let mut e=Engine::new();
        e.width=320;e.height=160;e.pixels=vec![0;320*160*4];
        e.encode_rotary(&[0.0,0.55,-0.46,0.0],1.0);
        e.render(0.0,0.0,0.0,35.0,0.8,0);
        let alpha=|x:usize,y:usize| e.pixels[(y*320+x)*4+3];
        assert_eq!(alpha(160,159),255,"the disc centre sits at the bottom crop");
        assert!(alpha(160,0)<255,"leave space above the upper rim");
        assert_eq!(alpha(160,30),255);
        assert!(alpha(0,159)<255,"the upper half fits the frame horizontally");
    }
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
    #[test] fn gpu_index_matches_cpu_cells() {
        let mut e=Engine::new();e.encode(0,1.0,1.0);
        assert_eq!(e.cell_offsets.len(),GRID*GRID+1);
        assert_eq!(e.gpu_scratches.len(),e.scratches.len()*8);
        for (i,cell) in e.cells.iter().enumerate() {
            let packed=&e.cell_indices[e.cell_offsets[i] as usize..e.cell_offsets[i+1] as usize];
            assert_eq!(packed.len(),cell.len());
            for (a,b) in packed.iter().zip(cell) { assert_eq!(*a as usize,*b); }
        }
        for (i,s) in e.scratches.iter().enumerate() {
            assert_eq!(&e.gpu_scratches[i*8..i*8+6],&[s.cx,s.cy,s.radius,s.nx,s.ny,s.facet_slope]);
        }
    }
    #[test] fn ray_tracer_has_disc_and_background() {
        let mut e=Engine::new();e.width=160;e.height=120;e.pixels=vec![0;160*120*4];e.encode(0,1.0,1.0);
        e.render(0.0,20.0,0.0,55.0,0.8,0);
        assert!(e.active>1000 && e.active<160*120);
        let alphas:Vec<u8>=e.pixels.iter().skip(3).step_by(4).copied().collect();
        assert!(alphas.iter().any(|a|*a==0));
        assert!(alphas.iter().any(|a|*a==255));
        assert!(alphas.iter().any(|a|*a>0 && *a<255));
        let initial=e.pixels.clone();e.render(0.0,20.0,30.0,55.0,0.8,0);
        assert_ne!(initial,e.pixels);
    }
    #[test] fn wall_light_surrounds_cast_shadow_and_fits_default_view() {
        let mut e=Engine::new();e.width=320;e.height=240;e.pixels=vec![0;320*240*4];
        e.render(0.0,0.0,0.0,35.0,0.8,0);
        let mut shadow_bottom=0;
        let mut light_bottom=0;
        let mut shadow_count=0;
        let mut light_count=0;
        let mut soft_edge_count=0;
        for y in 0..e.height { for x in 0..e.width {
            let i=(y*e.width+x)*4;
            let alpha=e.pixels[i+3];
            if alpha>0 && alpha<255 {
                if e.pixels[i]==0 {
                    shadow_count+=1;shadow_bottom=shadow_bottom.max(y);
                    assert!(alpha<=57,"shadow remains subtle");
                } else if e.pixels[i]==255 {
                    light_count+=1;light_bottom=light_bottom.max(y);
                    assert!(alpha<=27,"wall light must stay faint");
                } else {
                    soft_edge_count+=1;
                }
            }
            if x==0 || x==e.width-1 || y==0 || y==e.height-1 {
                assert_eq!(alpha,0,"default projection must fit the canvas");
            }
        } }
        assert!(shadow_count>100 && light_count>100);
        assert!(soft_edge_count>100,"shadow and light must share a soft transition");
        assert!(light_bottom>shadow_bottom,"wall light extends outside the shadow");
        let origin=orbit(0.0,0.0,CAMERA_DISTANCE);
        let wide_wall=[1.50,0.0,BACKING_PLANE_Z];
        let wide=e.trace(origin,unit(sub(wide_wall,origin)),orbit(0.0,35.0,LIGHT_DISTANCE),0.01,false,0.01);
        assert!(wide.0[0]>0.99 && wide.1>0 && wide.1<27,"the wall light reaches well beyond a narrow rim");
        let wall=[0.0,-1.40,BACKING_PLANE_Z];
        let ray=unit(sub(wall,origin));
        let lit=e.trace(origin,ray,orbit(0.0,35.0,LIGHT_DISTANCE),0.01,false,0.01);
        let blocked=e.trace(origin,ray,orbit(0.0,55.0,LIGHT_DISTANCE),0.01,false,0.01);
        assert!(lit.0[0]>0.0 && lit.1>0 && lit.1<255);
        assert_eq!(blocked.0,[0.0,0.0,0.0],"light elevation moves the cast shadow");
        assert!(blocked.1>0 && blocked.1<255);
        e.render(0.0,0.0,0.0,35.0,8.0,0);
        let wider_edge_count=e.pixels.chunks_exact(4)
            .filter(|p|p[3]>0 && p[3]<255 && p[0]>0 && p[0]<255).count();
        assert!(wider_edge_count>soft_edge_count,"a larger source softens the shadow further");
    }
    #[test] fn disc_rotation_keeps_geometry_and_wall_separate() {
        let mut e=Engine::new();e.width=160;e.height=120;e.pixels=vec![0;160*120*4];
        e.render(0.0,0.0,0.0,35.0,0.8,0);
        let initial=e.pixels.clone();
        for az in [-35.0,0.0,35.0] { for el in [-35.0,0.0,35.0] {
            e.disc=DiscPose::new(az,el);
            let pose=e.disc;
            assert!((dot(pose.x,pose.y)).abs()<1e-6);
            assert!((length(pose.normal)-1.0).abs()<1e-6);
            let point=[0.3,-0.2,-0.02];
            assert!(length(sub(pose.local(pose.world(point)),point))<1e-6);
            for i in 0..360 {
                let angle=(i as f32).to_radians();
                let rim=pose.world([angle.cos(),angle.sin(),-DISC_THICKNESS]);
                assert!(rim[2]-pose.wall_z()>=0.119,"the rotated plate cannot collide with the wall");
            }
            e.render(0.0,0.0,0.0,35.0,0.8,0);
            assert!(e.active>700,"the tilted disc remains visible");
            if az!=0.0 || el!=0.0 { assert_ne!(initial,e.pixels); }
            for y in 0..e.height { for x in 0..e.width {
                if x==0 || x==e.width-1 || y==0 || y==e.height-1 {
                    assert_eq!(e.pixels[(y*e.width+x)*4+3],0,"the default light fits at rotation {az}/{el}, pixel {x}/{y}");
                }
            } }
        } }
    }
    #[test] fn vinyl_and_metal_have_distinct_surfaces_without_changing_alpha() {
        let mut e=Engine::new();e.width=320;e.height=240;e.pixels=vec![0;320*240*4];
        e.render(0.0,0.0,0.0,35.0,0.8,0);
        let vinyl=e.pixels.clone();
        e.material=1;e.render(0.0,0.0,0.0,35.0,0.8,0);
        let mut vinyl_sum=0usize;let mut metal_sum=0usize;let mut count=0;
        for (v,m) in vinyl.chunks_exact(4).zip(e.pixels.chunks_exact(4)) {
            assert_eq!(v[3],m[3],"material selection must not change geometry or wall alpha");
            if v[3]==255 { vinyl_sum+=v[0] as usize;metal_sum+=m[0] as usize;count+=1; }
        }
        assert!(vinyl_sum/count<60,"vinyl must read as black rather than pale plastic");
        assert!(metal_sum>vinyl_sum*2,"the metal comparison must be visibly distinct");
        let light=orbit(0.0,35.0,LIGHT_DISTANCE);let camera=orbit(0.0,0.0,CAMERA_DISTANCE);
        let fine_a=e.shade([0.3,0.25,0.0],camera,light,0.01,false,0.0001);
        let fine_b=e.shade([0.3,0.26,0.0],camera,light,0.01,false,0.0001);
        assert_ne!(fine_a,fine_b,"brushing must be part of the surface shading");
    }
}
