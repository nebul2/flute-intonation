/* One handle for everything a view has to let go of.
 *
 * Views used to keep a named field per subscription -- offFrame, offState,
 * offSettings, control, help -- and null each one in teardown(). That worked
 * until two of them collided: views/scales.js assigned an engine.onState
 * unsubscribe to `this.offFrame` and then overwrote it with the real onFrame
 * unsubscribe, leaking the first. It survived only because startSession()
 * happened to call teardown() first.
 *
 * With an owner nothing is stored by name, so the collision is unrepresentable
 * and the list cannot fall out of step with what was actually subscribed:
 *
 *   teardown() { this.own?.dispose(); this.own = owner(); }
 *   const key = this.own.add(keyControl({ bind: "listenKey" }));
 *   this.own.add(engine.onFrame((f) => this.onFrame(f)));
 *   this.own.add(() => clearInterval(id));
 */
export function owner() {
  const parts = [];
  return {
    /* Returns its argument, so registering is never a separate statement to
     * forget. Accepts a handle with dispose() or a bare unsubscribe. */
    add(part) { parts.push(part); return part; },
    /* LIFO, and idempotent because it pops. One throwing handle must not
     * strand the rest -- a half-disposed view leaks listeners for the life of
     * the page. */
    dispose() {
      while (parts.length) {
        const part = parts.pop();
        try { (typeof part === "function" ? part : part.dispose)(); }
        catch (error) { console.error("dispose failed", error); }
      }
    },
    get size() { return parts.length; },
  };
}
