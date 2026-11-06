//! Solver iteration presets. Both variants use this table.

/// Quality preset controlling solver iteration counts and CCD substeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum QualityPreset {
    /// 2 solver iterations, 1 stabilization iteration, 1 CCD substep.
    Low = 0,
    /// 4 solver iterations, 2 stabilization iterations, 1 CCD substep.
    Medium = 1,
    /// 8 solver iterations, 3 stabilization iterations, 2 CCD substeps.
    High = 2,
    /// 10 solver iterations, 4 stabilization iterations, 4 CCD substeps.
    Esport = 3,
}

impl QualityPreset {
    /// Converts a raw `u8`. Unknown values are `Medium`.
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => QualityPreset::Low,
            2 => QualityPreset::High,
            3 => QualityPreset::Esport,
            _ => QualityPreset::Medium,
        }
    }
}

/// Solver counts copied onto the Rapier integration parameters.
#[derive(Debug, Clone, Copy)]
pub struct SolverConfig {
    /// Rapier `num_solver_iterations`.
    pub num_solver_iterations: usize,
    /// Rapier `num_internal_stabilization_iterations`.
    pub num_internal_stabilization_iterations: usize,
    /// Rapier `max_ccd_substeps`.
    pub max_ccd_substeps: usize,
}

/// Solver counts for `preset`.
pub fn solver_config(preset: QualityPreset) -> SolverConfig {
    match preset {
        QualityPreset::Low => SolverConfig {
            num_solver_iterations: 2,
            num_internal_stabilization_iterations: 1,
            max_ccd_substeps: 1,
        },
        QualityPreset::Medium => SolverConfig {
            num_solver_iterations: 4,
            num_internal_stabilization_iterations: 2,
            max_ccd_substeps: 1,
        },
        QualityPreset::High => SolverConfig {
            num_solver_iterations: 8,
            num_internal_stabilization_iterations: 3,
            max_ccd_substeps: 2,
        },
        QualityPreset::Esport => SolverConfig {
            num_solver_iterations: 10,
            num_internal_stabilization_iterations: 4,
            max_ccd_substeps: 4,
        },
    }
}
