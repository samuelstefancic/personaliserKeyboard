import {VIADefinitionV2, VIADefinitionV3} from '@the-via/reader';
import {useDispatch} from 'react-redux';
import {KeyboardAPI} from './keyboard-api';
import {useEffect, useState} from 'react';
import {setTestMatrixEnabled} from 'src/store/settingsSlice';
import {ConnectedDevice, TestKeyState} from 'src/types/types';
import {acquireMatrixStateSource} from './reactive-lighting/matrix-state-source';

export const useMatrixTest = (
  startTest: boolean,
  api?: KeyboardAPI,
  device?: ConnectedDevice,
  selectedDefinition?: VIADefinitionV2 | VIADefinitionV3,
) => {
  const selectedKeyArr = useState<any>([]);
  const [, setSelectedKeys] = selectedKeyArr;
  const dispatch = useDispatch();

  useEffect(() => {
    if (startTest && api && device && selectedDefinition) {
      const {cols, rows} = selectedDefinition.matrix;
      let initializedFromSnapshot = false;
      setSelectedKeys(Array(rows * cols).fill(TestKeyState.Initial));
      try {
        const matrixState = acquireMatrixStateSource(
          api,
          rows,
          cols,
          device.protocol,
          {
            onSnapshot: ({pressed}) => {
              if (initializedFromSnapshot) {
                return;
              }
              initializedFromSnapshot = true;
              setSelectedKeys(
                pressed.map((isPressed) =>
                  isPressed ? TestKeyState.KeyDown : TestKeyState.Initial,
                ),
              );
            },
            onTransitions: (transitions) => {
              setSelectedKeys((selectedKeys: unknown) => {
                const nextSelectedKeys =
                  Array.isArray(selectedKeys) &&
                  selectedKeys.length === rows * cols
                    ? [...selectedKeys]
                    : Array(rows * cols).fill(TestKeyState.Initial);
                transitions.forEach(({matrixIndex, state}) => {
                  nextSelectedKeys[matrixIndex] =
                    state === 'down'
                      ? TestKeyState.KeyDown
                      : TestKeyState.KeyUp;
                });
                return nextSelectedKeys;
              });
            },
            onError: () => {
              dispatch(setTestMatrixEnabled(false));
            },
          },
        );
        return () => matrixState.release();
      } catch {
        dispatch(setTestMatrixEnabled(false));
      }
    }

    return undefined;
  }, [startTest, selectedDefinition, api, device, dispatch, setSelectedKeys]);

  const downHandler = (evt: KeyboardEvent) => {
    evt.preventDefault();
  };
  const upHandler = (evt: KeyboardEvent) => {
    evt.preventDefault();
  };

  useEffect(() => {
    if (startTest) {
      window.addEventListener('keydown', downHandler);
      window.addEventListener('keyup', upHandler);
    }
    // Remove event listeners on cleanup
    return () => {
      window.removeEventListener('keydown', downHandler);
      window.removeEventListener('keyup', upHandler);
    };
  }, [startTest]);

  return selectedKeyArr;
};
