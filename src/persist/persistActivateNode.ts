import type {
    ListenerParams,
    NodeValue,
    ObservableOnChangeParams,
    ObservablePersistRemoteFunctions,
    ObservablePersistRemoteGetParams,
    ObservablePersistRemoteSetParams,
    UpdateFn,
} from '@legendapp/state';
import { internal, isPromise, mergeIntoObservable } from '@legendapp/state';
import { persistObservable } from './persistObservable';
const { getProxy, globalState, setupRetry } = internal;

export function persistActivateNode() {
    globalState.activateNode = function activateNodePersist(
        node: NodeValue,
        refresh: () => void,
        wasPromise: boolean,
        newValue: any,
    ) {
        const { onSetFn, subscriber, lastSync, cacheOptions, retryOptions } = node.activationState!;

        let onChange: UpdateFn | undefined = undefined;
        const pluginRemote: ObservablePersistRemoteFunctions = {
            get: async (params: ObservablePersistRemoteGetParams<any>) => {
                onChange = params.onChange;
                if (isPromise(newValue)) {
                    try {
                        newValue = await newValue;
                        // eslint-disable-next-line no-empty
                    } catch {}
                }
                if (lastSync.value) {
                    params.dateModified = lastSync.value;
                }
                return newValue;
            },
        };
        if (onSetFn) {
            // TODO: Work out these types better
            let timeoutRetry: { current?: any };
            pluginRemote.set = async (params: ObservablePersistRemoteSetParams<any>) => {
                if (node.state?.isLoaded.get()) {
                    return new Promise((resolve) => {
                        const attemptNum = { current: 0 };
                        const run = async () => {
                            let changes = {};
                            let maxModified = 0;
                            let didError = false;
                            let onError: () => void;
                            if (retryOptions) {
                                if (timeoutRetry?.current) {
                                    clearTimeout(timeoutRetry.current);
                                }
                                const { handleError, timeout } = setupRetry(retryOptions, run, attemptNum);
                                onError = handleError;
                                timeoutRetry = timeout;
                            }
                            await onSetFn(params as unknown as ListenerParams, {
                                update: (params) => {
                                    const { value, dateModified } = params;
                                    maxModified = Math.max(dateModified || 0, maxModified);
                                    changes = mergeIntoObservable(changes, value);
                                },
                                onError: () => {
                                    didError = true;
                                    onError?.();
                                },
                                refresh,
                            });
                            if (!didError) {
                                resolve({ changes, dateModified: maxModified || undefined });
                            }
                        };
                        run();
                    });
                }
            };
        }
        if (subscriber) {
            subscriber({
                update: (params: ObservableOnChangeParams) => {
                    if (!onChange) {
                        // TODO: Make this message better
                        console.log('[legend-state] Cannot update immediately before the first return');
                    } else {
                        onChange(params);
                    }
                },
                refresh,
            });
        }
        persistObservable(getProxy(node), {
            pluginRemote,
            ...(cacheOptions || {}),
            remote: {
                retry: retryOptions,
            },
        });

        return { update: onChange! };
    };
}
