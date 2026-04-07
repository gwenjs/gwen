/**
 * @fileoverview Character controller creation and management.
 */

import type { EntityId } from "@gwenjs/core";
import type {
  Physics3DAPI,
  Physics3DVec3,
  CharacterControllerOpts,
  CharacterControllerHandle,
} from "../types";
import { toEntityIndex } from "./physics3d-utils";
import { entityIndexToId } from "./plugin-helpers";
import type { PluginContext } from "./plugin-context";

/**
 * Returns a {@link CharacterControllerHandle} whose `move()` is a no-op and
 * all state properties return safe defaults.
 */
function createInertCharacterControllerHandle(): CharacterControllerHandle {
  const zero: Physics3DVec3 = { x: 0, y: 0, z: 0 };
  return {
    get isGrounded() {
      return false;
    },
    get groundNormal() {
      return null;
    },
    get groundEntity() {
      return null;
    },
    get lastTranslation() {
      return zero;
    },
    move(_desiredVelocity: Physics3DVec3, _dt: number) {
      // Pool exhausted — intentional no-op.
    },
  } satisfies CharacterControllerHandle;
}

export function createCharacterControllerMethods(
  ctx: PluginContext,
): Pick<Physics3DAPI, "addCharacterController" | "removeCharacterController"> {
  return {
    addCharacterController(
      entityId: EntityId,
      opts: CharacterControllerOpts = {},
    ): CharacterControllerHandle {
      const {
        stepHeight = 0.35,
        slopeLimit = 45,
        skinWidth = 0.02,
        snapToGround = 0.2,
        slideOnSteepSlopes = true,
        applyImpulsesToDynamic = true,
      } = opts;

      const entityIndex = toEntityIndex(entityId);

      if (ctx.backendMode === "wasm") {
        const slotIndex =
          ctx.wasmBridge?.physics3d_add_character_controller?.(
            entityIndex,
            stepHeight,
            slopeLimit,
            skinWidth,
            snapToGround,
            slideOnSteepSlopes,
            applyImpulsesToDynamic,
          ) ?? 0xffffffff;

        if (slotIndex === 0xffffffff) {
          if (import.meta.env.DEV) {
            ctx.log.warn("addCharacterController: CC pool exhausted (max 32 controllers)");
          }
          return createInertCharacterControllerHandle();
        }
        ctx.ccRegistrations.set(entityIndex, { slotIndex, entityIndex });

        const descBuf = ctx.ccDescriptorBuffer;

        let lastTranslation: Physics3DVec3 = { x: 0, y: 0, z: 0 };
        let _grounded = false;
        let _groundNormal: Physics3DVec3 | null = null;
        let _groundEntity: EntityId | null = null;

        const handle: CharacterControllerHandle = {
          get isGrounded() {
            return _grounded;
          },
          get groundNormal() {
            return _groundNormal;
          },
          get groundEntity() {
            return _groundEntity;
          },
          get lastTranslation() {
            return lastTranslation;
          },
          move(desiredVelocity: Physics3DVec3, dt: number) {
            let myDescSlot = -1;
            let _ccSlotIdx = 0;
            for (const _ccEntry of ctx.ccRegistrations.values()) {
              if (_ccEntry.entityIndex === entityIndex) {
                myDescSlot = _ccSlotIdx;
                break;
              }
              _ccSlotIdx++;
            }
            if (descBuf.view && myDescSlot >= 0) {
              const di = myDescSlot * 4;
              const tmp = new DataView(descBuf.view.buffer, descBuf.view.byteOffset + di * 4, 4);
              tmp.setUint32(0, entityIndex, true);
              descBuf.view[di + 1] = desiredVelocity.x;
              descBuf.view[di + 2] = desiredVelocity.y;
              descBuf.view[di + 3] = desiredVelocity.z;
            }
            ctx.wasmBridge?.physics3d_character_controller_move?.(
              entityIndex,
              desiredVelocity.x,
              desiredVelocity.y,
              desiredVelocity.z,
              dt,
            );
            const view = ctx.ccSABView.view;
            if (view !== null) {
              const base = slotIndex * ctx.CC_STATE_STRIDE;
              _grounded = view[base] !== 0;
              _groundNormal = _grounded
                ? { x: view[base + 1]!, y: view[base + 2]!, z: view[base + 3]! }
                : null;
              const groundBits = view[base + 4]!;
              ctx._castF32[0] = groundBits;
              const groundIdx = ctx._castU32[0]!;
              _groundEntity =
                _grounded && groundIdx !== 0xffffffff && groundIdx !== 0xfffffffe
                  ? entityIndexToId(ctx, groundIdx)
                  : null;
            } else {
              _grounded = false;
              _groundNormal = null;
              _groundEntity = null;
            }

            lastTranslation = {
              x: desiredVelocity.x * dt,
              y: desiredVelocity.y * dt,
              z: desiredVelocity.z * dt,
            };
          },
        };
        return handle;
      }

      // Local mode: return an inert handle with position-update fallback
      let lastTranslation: Physics3DVec3 = { x: 0, y: 0, z: 0 };
      return {
        get isGrounded() {
          return false;
        },
        get groundNormal() {
          return null;
        },
        get groundEntity() {
          return null;
        },
        get lastTranslation() {
          return lastTranslation;
        },
        move(v: Physics3DVec3, dt: number) {
          if (import.meta.env.DEV && !ctx._emittedCCLocalWarning) {
            ctx.log.warn("CharacterController uses local fallback — step-up/slope not supported");
            ctx._emittedCCLocalWarning = true;
          }
          const state = ctx.stateByEntity.get(entityIndex);
          if (state) {
            state.position = {
              x: state.position.x + v.x * dt,
              y: state.position.y + v.y * dt,
              z: state.position.z + v.z * dt,
            };
          }
          lastTranslation = { x: v.x * dt, y: v.y * dt, z: v.z * dt };
        },
      } satisfies CharacterControllerHandle;
    },

    removeCharacterController(entityId: EntityId): void {
      const entityIndex = toEntityIndex(entityId);
      ctx.ccRegistrations.delete(entityIndex);
      if (ctx.backendMode === "wasm") {
        ctx.wasmBridge?.physics3d_remove_character_controller?.(entityIndex);
      }
    },
  };
}
