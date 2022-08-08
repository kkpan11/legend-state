import { isFunction, observable, symbolGet } from '@legendapp/state';
import { useMemo } from 'react';
import type { ObservableObjectOrPrimitive } from '../observableInterfaces';
import { useObservables } from './useObservables';

/**
 * A React hook that creates a new observable and can optionally listen or persist its state.
 *
 * @param value The initial value of the observable or a function that returns the initial value
 * @param observe (optional) Listen to the observable for changes
 * @param persist (optional) PersistOptions for peristing the observable to state
 *
 * @see https://www.legendapp.com/dev/state/react/#usenewobservable
 */
export function useNewObservable<T>(value: T | (() => T), observe?: boolean): [ObservableObjectOrPrimitive<T>, T] {
    // Create the observable from the default value
    const obs = useMemo(() => observable<any>(isFunction(value) ? value() : value), []); // eslint-disable-line react-hooks/exhaustive-deps

    if (observe !== false) {
        useObservables(() => [obs]);
    }

    return [obs as any, obs[symbolGet as any]];
}
