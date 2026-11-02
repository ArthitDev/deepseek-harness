/**
 * The operator Peer: the one party this Host answers to. Connection owns it
 * for its own lifetime, admits every request as it, and hands it to each
 * Remote call as `invocation.peer`.
 * @module @deepseek-ai/dsh-client-connection/src/operator-peer
 */
import { randomUUID } from 'node:crypto';
import { createScope } from '@deepseek-ai/dsh-scope';
/**
 * The operator's scope. The instance is its own scope key, so `scopeOf(peer.ctx)`
 * returns it and events dispatched with `scopeTarget(subject, peer)` reach
 * listeners registered through `peer.ctx` and nobody else.
 */
export class OperatorPeer {
    id = randomUUID();
    ctx;
    scope;
    /** @param owner - Connection plugin context the scope fiber hangs under. */
    constructor(owner) {
        this.scope = createScope(owner, this);
        this.ctx = this.scope.ctx;
    }
    /** Tear down every connection-lifetime registration; racing calls share one completion. */
    dispose() {
        return this.scope.dispose();
    }
}
//# sourceMappingURL=operator-peer.js.map