//! Transform math - 2D vectors and matrices

use bytemuck::{Pod, Zeroable};
use std::ops::{Add, Mul, Sub};

/// 2D vector
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Vec2 {
    /// X coordinate
    pub x: f32,
    /// Y coordinate
    pub y: f32,
}

impl Vec2 {
    /// Create new vector
    pub const fn new(x: f32, y: f32) -> Self {
        Vec2 { x, y }
    }

    /// Zero vector
    pub const fn zero() -> Self {
        Vec2 { x: 0.0, y: 0.0 }
    }

    /// One vector
    pub const fn one() -> Self {
        Vec2 { x: 1.0, y: 1.0 }
    }

    /// Subtract vectors
    pub fn subtract(self, other: Vec2) -> Vec2 {
        self - other
    }

    /// Scale vector
    pub fn scale(self, scalar: f32) -> Vec2 {
        self * scalar
    }

    /// Dot product
    pub fn dot(self, other: Vec2) -> f32 {
        self.x * other.x + self.y * other.y
    }

    /// Length
    pub fn length(self) -> f32 {
        (self.x * self.x + self.y * self.y).sqrt()
    }

    /// Normalize
    pub fn normalize(self) -> Vec2 {
        let len = self.length();
        if len == 0.0 {
            Vec2::zero()
        } else {
            Vec2 {
                x: self.x / len,
                y: self.y / len,
            }
        }
    }

    /// Rotate around origin
    pub fn rotate(self, angle: f32) -> Vec2 {
        let cos = angle.cos();
        let sin = angle.sin();
        Vec2 {
            x: self.x * cos - self.y * sin,
            y: self.x * sin + self.y * cos,
        }
    }

    /// Distance to another vector
    pub fn distance(self, other: Vec2) -> f32 {
        (self - other).length()
    }

    /// Lerp (linear interpolation)
    pub fn lerp(self, other: Vec2, t: f32) -> Vec2 {
        Vec2 {
            x: self.x + (other.x - self.x) * t,
            y: self.y + (other.y - self.y) * t,
        }
    }
}

impl Add for Vec2 {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Vec2 {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}

impl Sub for Vec2 {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Vec2 {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }
}

impl Mul<f32> for Vec2 {
    type Output = Self;

    fn mul(self, scalar: f32) -> Self {
        Vec2 {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

/// 3x3 matrix for 2D transformations
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
#[repr(C)]
pub struct Mat3 {
    // Row-major: m[row][col]
    m: [f32; 9],
}

impl Mat3 {
    /// Identity matrix
    pub fn identity() -> Self {
        Mat3 {
            m: [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        }
    }

    /// Translation matrix
    pub fn translate(x: f32, y: f32) -> Self {
        Mat3 {
            m: [1.0, 0.0, x, 0.0, 1.0, y, 0.0, 0.0, 1.0],
        }
    }

    /// Rotation matrix (angle in radians)
    pub fn rotate(angle: f32) -> Self {
        let cos = angle.cos();
        let sin = angle.sin();
        Mat3 {
            m: [cos, -sin, 0.0, sin, cos, 0.0, 0.0, 0.0, 1.0],
        }
    }

    /// Scale matrix
    pub fn scale(sx: f32, sy: f32) -> Self {
        Mat3 {
            m: [sx, 0.0, 0.0, 0.0, sy, 0.0, 0.0, 0.0, 1.0],
        }
    }

    /// Create transform matrix (T * R * S order)
    pub fn transform(position: Vec2, rotation: f32, scale: Vec2) -> Self {
        let cos = rotation.cos();
        let sin = rotation.sin();

        Mat3 {
            m: [
                scale.x * cos,
                -scale.y * sin,
                position.x,
                scale.x * sin,
                scale.y * cos,
                position.y,
                0.0,
                0.0,
                1.0,
            ],
        }
    }

    /// Multiply two matrices
    pub fn multiply(self, other: Mat3) -> Mat3 {
        let mut result = [0.0; 9];

        for i in 0..3 {
            for j in 0..3 {
                for k in 0..3 {
                    result[i * 3 + j] += self.m[i * 3 + k] * other.m[k * 3 + j];
                }
            }
        }

        Mat3 { m: result }
    }

    /// Transform a vector
    pub fn transform_vec2(self, v: Vec2) -> Vec2 {
        Vec2 {
            x: self.m[0] * v.x + self.m[1] * v.y + self.m[2],
            y: self.m[3] * v.x + self.m[4] * v.y + self.m[5],
        }
    }

    /// Determinant
    pub fn determinant(self) -> f32 {
        self.m[0] * (self.m[4] * self.m[8] - self.m[5] * self.m[7])
            - self.m[1] * (self.m[3] * self.m[8] - self.m[5] * self.m[6])
            + self.m[2] * (self.m[3] * self.m[7] - self.m[4] * self.m[6])
    }

    /// Inverse matrix
    pub fn inverse(self) -> Option<Mat3> {
        let det = self.determinant();
        if det.abs() < 1e-6 {
            return None;
        }

        let inv_det = 1.0 / det;

        let mut result = [0.0; 9];
        result[0] = (self.m[4] * self.m[8] - self.m[5] * self.m[7]) * inv_det;
        result[1] = -(self.m[1] * self.m[8] - self.m[2] * self.m[7]) * inv_det;
        result[2] = (self.m[1] * self.m[5] - self.m[2] * self.m[4]) * inv_det;
        result[3] = -(self.m[3] * self.m[8] - self.m[5] * self.m[6]) * inv_det;
        result[4] = (self.m[0] * self.m[8] - self.m[2] * self.m[6]) * inv_det;
        result[5] = -(self.m[0] * self.m[5] - self.m[2] * self.m[3]) * inv_det;
        result[6] = (self.m[3] * self.m[7] - self.m[4] * self.m[6]) * inv_det;
        result[7] = -(self.m[0] * self.m[7] - self.m[1] * self.m[6]) * inv_det;
        result[8] = (self.m[0] * self.m[4] - self.m[1] * self.m[3]) * inv_det;

        Some(Mat3 { m: result })
    }

    /// Get as array
    pub fn as_array(&self) -> &[f32; 9] {
        &self.m
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vec2_creation() {
        let v = Vec2::new(3.0, 4.0);
        assert_eq!(v.x, 3.0);
        assert_eq!(v.y, 4.0);
    }

    #[test]
    fn test_vec2_length() {
        let v = Vec2::new(3.0, 4.0);
        assert!((v.length() - 5.0).abs() < 0.01);
    }

    #[test]
    fn test_vec2_add() {
        let a = Vec2::new(1.0, 2.0);
        let b = Vec2::new(3.0, 4.0);
        let c = a + b;
        assert_eq!(c.x, 4.0);
        assert_eq!(c.y, 6.0);
    }

    #[test]
    fn test_vec2_normalize() {
        let v = Vec2::new(3.0, 4.0);
        let n = v.normalize();
        let len = n.length();
        assert!((len - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_mat3_identity() {
        let m = Mat3::identity();
        let v = Vec2::new(5.0, 10.0);
        let result = m.transform_vec2(v);
        assert!((result.x - 5.0).abs() < 0.01);
        assert!((result.y - 10.0).abs() < 0.01);
    }

    #[test]
    fn test_mat3_translate() {
        let m = Mat3::translate(10.0, 20.0);
        let v = Vec2::new(5.0, 10.0);
        let result = m.transform_vec2(v);
        assert!((result.x - 15.0).abs() < 0.01);
        assert!((result.y - 30.0).abs() < 0.01);
    }

    #[test]
    fn test_mat3_rotate() {
        let m = Mat3::rotate(std::f32::consts::PI / 2.0); // 90 degrees
        let v = Vec2::new(1.0, 0.0);
        let result = m.transform_vec2(v);
        assert!(result.x.abs() < 0.01);
        assert!((result.y - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_mat3_multiply() {
        let t = Mat3::translate(10.0, 0.0);
        let s = Mat3::scale(2.0, 2.0);
        let combined = t.multiply(s);

        let v = Vec2::new(1.0, 1.0);
        let result = combined.transform_vec2(v);
        assert!((result.x - 12.0).abs() < 0.01);
        assert!((result.y - 2.0).abs() < 0.01);
    }

    #[test]
    fn test_mat3_inverse() {
        let m = Mat3::translate(5.0, 10.0);
        let inv = m.inverse().unwrap();
        let combined = m.multiply(inv);

        let identity = Mat3::identity();
        for i in 0..9 {
            assert!((combined.m[i] - identity.m[i]).abs() < 0.01);
        }
    }

    #[test]
    fn test_mat3_transform() {
        let m = Mat3::transform(Vec2::new(10.0, 20.0), 0.0, Vec2::new(2.0, 2.0));
        let v = Vec2::new(1.0, 1.0);
        let result = m.transform_vec2(v);
        assert!((result.x - 12.0).abs() < 0.01);
        assert!((result.y - 22.0).abs() < 0.01);
    }
}
