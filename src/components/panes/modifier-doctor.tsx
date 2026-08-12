import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import styled from 'styled-components';
import {AccentButton} from '../inputs/accent-button';
import {ControlRow, Detail, Label} from './grid';
import {useAppDispatch, useAppSelector} from 'src/store/hooks';
import {
  getSelectedConnectedDevice,
  getSelectedKeyboardAPI,
  getIsSelectedDeviceReady,
} from 'src/store/devicesSlice';
import {
  getBasicKeyToByte,
  getSelectedDefinition,
} from 'src/store/definitionsSlice';
import {getSelectedRawLayers, setKey} from 'src/store/keymapSlice';
import {
  getActiveConnectionProfile,
  getActiveKeyboardTransport,
  getHostKeyboardLayout,
} from 'src/store/settingsSlice';
import {getCodeForByte} from 'src/utils/key';
import {
  applyVerifiedKeyChange,
  classifyRightModifier,
  expectedAltGrText,
  rollbackVerifiedKeyChange,
  type ModifierHostSample,
  type ModifierKeyTarget,
  type VerifiedKeyChangeResult,
} from 'src/utils/modifier-doctor';
import {
  acquireMatrixStateSource,
  type MatrixStateSourceHandle,
} from 'src/utils/reactive-lighting/matrix-state-source';
import {PROTOCOL_GAMMA} from 'src/utils/via-protocol';
import {PLATFORM_LABELS, TRANSPORT_LABELS} from 'src/utils/device-transport';
import {EVO75_VENDOR_PRODUCT_ID} from 'src/utils/bundled-definitions';

const Doctor = styled.section`
  border: 1px solid var(--border_color_cell);
  border-radius: 8px;
  margin: 20px 5px;
  max-width: 960px;
  padding: 12px;
  width: calc(100% - 10px);
`;

const DoctorTitle = styled.h2`
  color: var(--color_label-highlighted);
  font-size: 22px;
  margin: 0 0 6px;
`;

const DoctorText = styled.p`
  color: var(--color_label);
  font-size: 15px;
  line-height: 1.45;
  margin: 6px 0 12px;
`;

const CaptureInput = styled.input`
  background: var(--bg_menu);
  border: 1px solid var(--color_accent);
  border-radius: 5px;
  color: var(--color_label-highlighted);
  font-size: 18px;
  min-height: 40px;
  padding: 0 10px;
  width: min(420px, 80vw);
`;

const ButtonGroup = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
`;

const Result = styled.div<{$warning?: boolean}>`
  color: ${(props) =>
    props.$warning ? 'var(--color_error)' : 'var(--color_label-highlighted)'};
  font-size: 15px;
  line-height: 1.45;
  padding: 8px 5px;
`;

const captureSample = (
  event: ReactKeyboardEvent<HTMLInputElement>,
): ModifierHostSample => ({
  type: event.type === 'keyup' ? 'keyup' : 'keydown',
  code: event.code,
  key: event.key,
  location: event.location,
  ctrlKey: event.ctrlKey,
  altKey: event.altKey,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
  altGraph: event.getModifierState('AltGraph'),
  repeat: event.repeat,
});

const verdictLabels = {
  'right-alt': 'Windows reçoit bien Right Alt / AltGr.',
  'right-gui': 'Windows reçoit Right GUI / Win à la place de Right Alt.',
  ambiguous: 'Le signal reçu est ambigu : aucune correction ne sera proposée.',
  insufficient: 'Appuie sur la touche AltGr droite dans le champ ci-dessous.',
} as const;

const resultLabel = (result: VerifiedKeyChangeResult | null): string => {
  if (!result) {
    return '';
  }
  switch (result.status) {
    case 'applied':
      return 'Écriture unitaire relue et vérifiée.';
    case 'precondition-failed':
      return 'La touche a changé depuis la lecture : aucune écriture effectuée.';
    case 'write-not-applied':
      return "La commande n'a pas modifié la touche.";
    case 'rolled-back':
      return 'La vérification a échoué ; la valeur originale a été restaurée.';
    case 'unsafe-state':
      return `État inattendu : ${result.reason}`;
  }
};

export const ModifierDoctor = () => {
  const dispatch = useAppDispatch();
  const device = useAppSelector(getSelectedConnectedDevice);
  const api = useAppSelector(getSelectedKeyboardAPI);
  const isDeviceReady = useAppSelector(getIsSelectedDeviceReady);
  const definition = useAppSelector(getSelectedDefinition);
  const rawLayers = useAppSelector(getSelectedRawLayers);
  const {basicKeyToByte, byteToKey} = useAppSelector(getBasicKeyToByte);
  const activeProfile = useAppSelector(getActiveConnectionProfile);
  const activeTransport = useAppSelector(getActiveKeyboardTransport);
  const hostKeyboardLayout = useAppSelector(getHostKeyboardLayout);

  const [samples, setSamples] = useState<ModifierHostSample[]>([]);
  const [insertedText, setInsertedText] = useState('');
  const [isProbing, setIsProbing] = useState(false);
  const [probeError, setProbeError] = useState('');
  const [target, setTarget] = useState<
    | (ModifierKeyTarget & {
        matrixIndex: number;
        devicePath: string;
        vendorProductId: number;
        cachedCode?: number;
      })
    | null
  >(null);
  const [inspectedCode, setInspectedCode] = useState<number | null>(null);
  const [transaction, setTransaction] =
    useState<VerifiedKeyChangeResult | null>(null);
  const [isTransactionPending, setIsTransactionPending] = useState(false);
  const [receipt, setReceipt] = useState<{
    devicePath: string;
    vendorProductId: number;
    matrixIndex: number;
    keyTarget: ModifierKeyTarget;
    original: number;
    replacement: number;
  } | null>(null);
  const matrixHandleRef = useRef<MatrixStateSourceHandle | null>(null);
  const operationEpochRef = useRef(0);
  const activeDevicePathRef = useRef(device?.path);
  const transactionLockRef = useRef(false);

  const hostVerdict = useMemo(() => classifyRightModifier(samples), [samples]);
  const expectedText = expectedAltGrText(hostKeyboardLayout);
  const codeLabel = (value: number | null | undefined) =>
    value === null || value === undefined
      ? '—'
      : getCodeForByte(value, basicKeyToByte, byteToKey);
  const rightAlt = basicKeyToByte.KC_RALT;
  const guiCodes = [basicKeyToByte.KC_LGUI, basicKeyToByte.KC_RGUI].filter(
    (value): value is number => typeof value === 'number',
  );
  const canProbe = Boolean(
    api &&
      device &&
      definition &&
      isDeviceReady &&
      device.vendorProductId === EVO75_VENDOR_PRODUCT_ID &&
      device.protocol >= PROTOCOL_GAMMA,
  );
  const canCorrect = Boolean(
    api &&
      device &&
      isDeviceReady &&
      !isTransactionPending &&
      device.vendorProductId === EVO75_VENDOR_PRODUCT_ID &&
      target &&
      target.devicePath === device.path &&
      target.vendorProductId === device.vendorProductId &&
      inspectedCode !== null &&
      hostVerdict === 'right-gui' &&
      activeProfile.platform === 'windows' &&
      guiCodes.includes(inspectedCode) &&
      typeof rightAlt === 'number',
  );

  const stopProbe = () => {
    matrixHandleRef.current?.release();
    matrixHandleRef.current = null;
    setIsProbing(false);
  };

  useEffect(() => stopProbe, []);

  useEffect(() => {
    activeDevicePathRef.current = device?.path;
    operationEpochRef.current++;
    stopProbe();
    setTarget(null);
    setInspectedCode(null);
    setTransaction(null);
    setReceipt(null);
    setIsTransactionPending(false);
    transactionLockRef.current = false;
  }, [device?.path, activeTransport, activeProfile.platform]);

  const startProbe = () => {
    if (
      !api ||
      !device ||
      !definition ||
      !isDeviceReady ||
      device.vendorProductId !== EVO75_VENDOR_PRODUCT_ID ||
      device.protocol < PROTOCOL_GAMMA
    ) {
      return;
    }
    stopProbe();
    setProbeError('');
    setTarget(null);
    setInspectedCode(null);
    setTransaction(null);
    setReceipt(null);
    setIsProbing(true);
    const devicePath = device.path;
    const vendorProductId = device.vendorProductId;
    try {
      matrixHandleRef.current = acquireMatrixStateSource(
        api,
        definition.matrix.rows,
        definition.matrix.cols,
        device.protocol,
        {
          onTransitions: (transitions) => {
            if (activeDevicePathRef.current !== devicePath) {
              stopProbe();
              return;
            }
            const pressed = transitions.filter(({state}) => state === 'down');
            if (pressed.length !== 1) {
              if (pressed.length > 1) {
                setProbeError(
                  'Plusieurs touches ont été détectées : recommence avec AltGr seule.',
                );
                stopProbe();
              }
              return;
            }
            const {row, col, matrixIndex} = pressed[0];
            const isEvo75AltGrPosition = row === 5 && col === 10;
            if (!isEvo75AltGrPosition) {
              setProbeError(
                `La position ligne ${row}, colonne ${col} n'est pas la touche AltGr attendue de l'EVO75. Aucune correction possible.`,
              );
              stopProbe();
              return;
            }
            setTarget({
              layer: 0,
              row,
              col,
              matrixIndex,
              devicePath,
              vendorProductId,
              cachedCode: rawLayers[0]?.keymap[matrixIndex],
            });
            stopProbe();
          },
          onError: (error) => {
            setProbeError(error.message);
            stopProbe();
          },
        },
      );
    } catch (error) {
      setProbeError(error instanceof Error ? error.message : String(error));
      stopProbe();
    }
  };

  const inspectTarget = async () => {
    if (
      !api ||
      !device ||
      !target ||
      target.devicePath !== device.path ||
      target.vendorProductId !== device.vendorProductId ||
      !isDeviceReady ||
      device.vendorProductId !== EVO75_VENDOR_PRODUCT_ID ||
      isTransactionPending ||
      transactionLockRef.current
    ) {
      return;
    }
    transactionLockRef.current = true;
    const operationEpoch = ++operationEpochRef.current;
    const devicePath = device.path;
    setIsTransactionPending(true);
    setTransaction(null);
    try {
      const code = await api.getKey(target.layer, target.row, target.col);
      if (
        operationEpoch === operationEpochRef.current &&
        activeDevicePathRef.current === devicePath
      ) {
        setInspectedCode(code);
      }
    } catch (error) {
      if (operationEpoch === operationEpochRef.current) {
        setProbeError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operationEpoch === operationEpochRef.current) {
        setIsTransactionPending(false);
        transactionLockRef.current = false;
      }
    }
  };

  const correctTarget = async () => {
    if (
      !api ||
      !device ||
      !target ||
      inspectedCode === null ||
      typeof rightAlt !== 'number' ||
      isTransactionPending ||
      transactionLockRef.current ||
      !isDeviceReady ||
      device.vendorProductId !== EVO75_VENDOR_PRODUCT_ID ||
      target.devicePath !== device.path ||
      target.vendorProductId !== device.vendorProductId ||
      hostVerdict !== 'right-gui' ||
      activeProfile.platform !== 'windows' ||
      !guiCodes.includes(inspectedCode)
    ) {
      return;
    }
    transactionLockRef.current = true;
    const operationEpoch = ++operationEpochRef.current;
    const devicePath = device.path;
    const vendorProductId = device.vendorProductId;
    setIsTransactionPending(true);
    setProbeError('');
    try {
      const result = await applyVerifiedKeyChange(
        api,
        target,
        inspectedCode,
        rightAlt,
      );
      if (
        operationEpoch !== operationEpochRef.current ||
        activeDevicePathRef.current !== devicePath
      ) {
        return;
      }
      setTransaction(result);
      if (result.status === 'applied') {
        dispatch(
          setKey({
            devicePath: device.path,
            keymapIndex: target.matrixIndex,
            value: rightAlt,
            layerIndex: target.layer,
          }),
        );
        setReceipt({
          devicePath,
          vendorProductId,
          matrixIndex: target.matrixIndex,
          keyTarget: target,
          original: inspectedCode,
          replacement: rightAlt,
        });
        setInspectedCode(rightAlt);
      }
    } catch (error) {
      if (operationEpoch === operationEpochRef.current) {
        setProbeError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operationEpoch === operationEpochRef.current) {
        setIsTransactionPending(false);
        transactionLockRef.current = false;
      }
    }
  };

  const rollback = async () => {
    if (
      !api ||
      !device ||
      !target ||
      !receipt ||
      isTransactionPending ||
      transactionLockRef.current ||
      receipt.devicePath !== device.path ||
      receipt.vendorProductId !== device.vendorProductId ||
      receipt.matrixIndex !== target.matrixIndex ||
      target.devicePath !== device.path ||
      target.vendorProductId !== device.vendorProductId ||
      !isDeviceReady ||
      device.vendorProductId !== EVO75_VENDOR_PRODUCT_ID
    ) {
      return;
    }
    transactionLockRef.current = true;
    const operationEpoch = ++operationEpochRef.current;
    const devicePath = device.path;
    setIsTransactionPending(true);
    setProbeError('');
    try {
      const result = await rollbackVerifiedKeyChange(
        api,
        receipt.keyTarget,
        receipt.replacement,
        receipt.original,
      );
      if (
        operationEpoch !== operationEpochRef.current ||
        activeDevicePathRef.current !== devicePath
      ) {
        return;
      }
      setTransaction(result);
      if (result.status === 'applied') {
        dispatch(
          setKey({
            devicePath,
            keymapIndex: receipt.matrixIndex,
            value: receipt.original,
            layerIndex: receipt.keyTarget.layer,
          }),
        );
        setInspectedCode(receipt.original);
        setReceipt(null);
      }
    } catch (error) {
      if (operationEpoch === operationEpochRef.current) {
        setProbeError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (operationEpoch === operationEpochRef.current) {
        setIsTransactionPending(false);
        transactionLockRef.current = false;
      }
    }
  };

  const captureKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    setSamples((current) => [...current.slice(-15), captureSample(event)]);
  };

  const captureInput = (event: FormEvent<HTMLInputElement>) => {
    setInsertedText(event.currentTarget.value);
  };

  return (
    <Doctor aria-label="Diagnostic des modificateurs Windows">
      <DoctorTitle>Diagnostic AltGr Windows</DoctorTitle>
      <DoctorText>
        Contexte déclaré : {TRANSPORT_LABELS[activeTransport]} vers{' '}
        {PLATFORM_LABELS[activeProfile.platform]}. Ce diagnostic compare ce que
        reçoit le navigateur avec la touche réellement stockée en couche 0.
      </DoctorText>
      <ControlRow>
        <Label>1. Signal reçu par la machine</Label>
        <Detail>
          <CaptureInput
            aria-label="Zone de test AltGr"
            value={insertedText}
            placeholder="Appuie sur AltGr, puis teste AltGr + 0"
            onKeyDown={captureKey}
            onKeyUp={captureKey}
            onInput={captureInput}
            onChange={captureInput}
          />
        </Detail>
      </ControlRow>
      <Result
        $warning={hostVerdict === 'right-gui' || hostVerdict === 'ambiguous'}
      >
        {verdictLabels[hostVerdict]}
        {expectedText
          ? ` Pour la disposition Français historique, AltGr + 0 doit insérer « ${expectedText} »${
              insertedText === expectedText ? ' — résultat conforme.' : '.'
            }`
          : ' La disposition sélectionnée ne permet pas de conclure avec le caractère @.'}
      </Result>
      <ControlRow>
        <Label>2. Position physique AltGr</Label>
        <Detail>
          <ButtonGroup>
            <AccentButton
              disabled={!canProbe || isProbing || isTransactionPending}
              onClick={startProbe}
            >
              {isProbing ? 'Appuie sur AltGr…' : 'Armer la lecture'}
            </AccentButton>
            <AccentButton
              disabled={!target || isTransactionPending}
              onClick={inspectTarget}
            >
              Lire le keycode
            </AccentButton>
          </ButtonGroup>
        </Detail>
      </ControlRow>
      <Result $warning={Boolean(probeError)}>
        {probeError ||
          (target
            ? `Couche 0 · ligne ${target.row} · colonne ${target.col} · cache ${codeLabel(
                target.cachedCode,
              )} · lecture ${codeLabel(inspectedCode)}`
            : canProbe
              ? 'Arme la lecture puis appuie uniquement sur la touche AltGr physique.'
              : 'La lecture matricielle nécessite un clavier VIA connecté avec le protocole requis.')}
      </Result>
      <ControlRow>
        <Label>3. Correction unitaire vérifiée</Label>
        <Detail>
          <ButtonGroup>
            <AccentButton disabled={!canCorrect} onClick={correctTarget}>
              Remplacer par KC_RALT
            </AccentButton>
            <AccentButton
              disabled={!receipt || isTransactionPending}
              onClick={rollback}
            >
              Restaurer {receipt ? codeLabel(receipt.original) : ''}
            </AccentButton>
          </ButtonGroup>
        </Detail>
      </ControlRow>
      <Result
        $warning={
          transaction !== null &&
          transaction.status !== 'applied' &&
          transaction.status !== 'rolled-back'
        }
      >
        {transaction
          ? resultLabel(transaction)
          : inspectedCode === rightAlt
            ? 'La keymap contient déjà KC_RALT : aucune réécriture. Vérifie plutôt le mode Win/Mac ou un swap global.'
            : canCorrect
              ? 'Une action écrit exactement cette touche, la relit, puis restaure automatiquement sa valeur originale si la commande échoue après envoi.'
              : 'La correction reste bloquée tant que le profil Windows, le signal Right GUI et le keycode GUI de cette position ne concordent pas.'}
      </Result>
      <ButtonGroup>
        <AccentButton
          onClick={() => {
            setSamples([]);
            setInsertedText('');
            setProbeError('');
            setTransaction(null);
          }}
        >
          Effacer le diagnostic
        </AccentButton>
      </ButtonGroup>
    </Doctor>
  );
};
