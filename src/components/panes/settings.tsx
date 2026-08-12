import {useEffect, useState} from 'react';
import {Pane} from './pane';
import styled from 'styled-components';
import {
  ControlRow,
  Label,
  Detail,
  Grid,
  MenuCell,
  Row,
  IconContainer,
  SpanOverflowCell,
} from './grid';
import {AccentSlider} from '../inputs/accent-slider';
import {useDispatch} from 'react-redux';
import {useAppSelector} from 'src/store/hooks';
import {
  getShowDesignTab,
  getShowConsoleTab,
  getShowDesignTabConfirmationNotice,
  getDisableFastRemap,
  getShowSliderValuesMode,
  toggleCreatorMode,
  toggleConsoleTab,
  toggleFastRemap,
  updateShowSliderValuesMode,
  getThemeMode,
  toggleThemeMode,
  getThemeName,
  updateThemeName,
  getRenderMode,
  updateRenderMode,
  setShowDesignTabConfirmationNotice,
  getConnectionProfiles,
  setActiveKeyboardTransport,
  updateConnectionProfile,
} from 'src/store/settingsSlice';
import {AccentSelect} from '../inputs/accent-select';
import {THEMES} from 'src/utils/themes';
import {MenuContainer} from './configure-panes/custom/menu-generator';
import {MenuTooltip} from '../inputs/tooltip';
import {FontAwesomeIcon} from '@fortawesome/react-fontawesome';
import {faToolbox} from '@fortawesome/free-solid-svg-icons';
import {getSelectedConnectedDevice} from 'src/store/devicesSlice';
import {ErrorMessage} from '../styled';
import {webGLIsAvailable} from 'src/utils/test-webgl';
import {useTranslation} from 'react-i18next';
import {MessageDialog} from '../inputs/message-dialog';
import {
  HOST_PLATFORMS,
  PLATFORM_LABELS,
  TRANSPORT_LABELS,
} from 'src/utils/device-transport';
import type {HostPlatform, KeyboardTransport} from 'src/types/types';
import {EVO75_VENDOR_PRODUCT_ID} from 'src/utils/bundled-definitions';

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

const DiagnosticContainer = styled(Container)`
  margin-top: 20px;
  padding-top: 20px;
`;

const SettingsErrorMessage = styled(ErrorMessage)`
  margin: 0;
  font-style: italic;
`;

const ExplanatoryText = styled.p`
  color: var(--color_label);
  font-size: 15px;
  line-height: 1.45;
  margin: 12px 5px 18px;
  max-width: 950px;
  width: 100%;
`;

export const Settings = () => {
  const {t} = useTranslation();
  const dispatch = useDispatch();
  const showDesignTab = useAppSelector(getShowDesignTab);
  const showConsoleTab = useAppSelector(getShowConsoleTab);
  const showDesignTabConfirmationNotice = useAppSelector(
    getShowDesignTabConfirmationNotice,
  );
  const disableFastRemap = useAppSelector(getDisableFastRemap);
  const ShowSliderValuesMode = useAppSelector(getShowSliderValuesMode);
  const themeMode = useAppSelector(getThemeMode);
  const themeName = useAppSelector(getThemeName);
  const renderMode = useAppSelector(getRenderMode);
  const selectedDevice = useAppSelector(getSelectedConnectedDevice);
  const connectionProfiles = useAppSelector(getConnectionProfiles);

  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [showDesignTabNotice, setShowDesignTabNotice] = useState(false);

  useEffect(() => {
    if (showDesignTabConfirmationNotice) {
      setShowDesignTabNotice(true);
      dispatch(setShowDesignTabConfirmationNotice(false));
    }
  }, [dispatch, showDesignTabConfirmationNotice]);

  const themeSelectOptions = Object.keys(THEMES).map((k) => ({
    label: t(k.replaceAll('_', ' ')),
    value: k,
  }));
  const themeDefaultValue = themeSelectOptions.find(
    (opt) => opt.value === themeName,
  );

  const ShowSliderModeOptions = webGLIsAvailable
    ? [
        {
          label: t('Slider Only'),
          value: 'Slider Only',
        },
        {
          label: t('Slider & Show Value'),
          value: 'Slider & Show Value',
        },
        {
          label: t('Slider & Input Field'),
          value: 'Slider & Input Field',
        },
      ]
    : [{label: t('Slider Only'), value: 'Slider Only'}];
  const showSliderModeDefaultValue = ShowSliderModeOptions.find(
    (opt) => opt.value === ShowSliderValuesMode,
  );

  const renderModeOptions = webGLIsAvailable
    ? [
        {
          label: t('2D'),
          value: '2D',
        },
        {
          label: t('3D'),
          value: '3D',
        },
      ]
    : [{label: t('2D'), value: '2D'}];
  const renderModeDefaultValue = renderModeOptions.find(
    (opt) => opt.value === renderMode,
  );
  const transportOptions = Object.entries(TRANSPORT_LABELS).map(
    ([value, label]) => ({value, label: t(label)}),
  );
  const platformOptions = HOST_PLATFORMS.map((value) => ({
    value,
    label: t(PLATFORM_LABELS[value]),
  }));
  const activeTransport = connectionProfiles.activeTransport;
  const activeProfile = connectionProfiles.profiles[activeTransport];
  const activeTransportOption = transportOptions.find(
    ({value}) => value === activeTransport,
  );
  const activePlatformOption = platformOptions.find(
    ({value}) => value === activeProfile.platform,
  );
  const selectedInterfaceIsEvo75 =
    selectedDevice?.vendorProductId === EVO75_VENDOR_PRODUCT_ID;
  return (
    <Pane>
      <Grid style={{overflow: 'hidden'}}>
        <MenuCell style={{pointerEvents: 'all', borderTop: 'none'}}>
          <MenuContainer>
            <Row $selected={true}>
              <IconContainer>
                <FontAwesomeIcon icon={faToolbox} />
                <MenuTooltip>{t('General')}</MenuTooltip>
              </IconContainer>
            </Row>
          </MenuContainer>
        </MenuCell>
        <SpanOverflowCell style={{flex: 1, borderWidth: 0}}>
          <Container>
            <ControlRow>
              <Label>{t('Show Design tab')}</Label>
              <Detail>
                <AccentSlider
                  onChange={() => dispatch(toggleCreatorMode())}
                  isChecked={showDesignTab}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Contexte de connexion EVO75')}</Label>
              <Detail>
                <AccentSelect
                  isSearchable={false}
                  value={activeTransportOption}
                  options={transportOptions}
                  onChange={(option: any) => {
                    option &&
                      dispatch(
                        setActiveKeyboardTransport(
                          option.value as KeyboardTransport,
                        ),
                      );
                  }}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Machine cible pour ce contexte')}</Label>
              <Detail>
                <AccentSelect
                  isSearchable={false}
                  value={activePlatformOption}
                  options={platformOptions}
                  onChange={(option: any) => {
                    option &&
                      dispatch(
                        updateConnectionProfile({
                          transport: activeTransport,
                          changes: {
                            platform: option.value as HostPlatform,
                          },
                        }),
                      );
                  }}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Interface VIA actuellement sélectionnée')}</Label>
              <Detail>
                {selectedInterfaceIsEvo75
                  ? t('EVO75 visible · transport non vérifiable')
                  : t('Aucun EVO75 sélectionné via VIA Raw HID')}
              </Detail>
            </ControlRow>
            <ExplanatoryText>
              {t(
                "Ce contexte est déclaré localement : WebHID ne révèle pas si le clavier passe par le câble, le récepteur 2,4 GHz ou Bluetooth. USB cible Windows ; les deux modes sans fil ciblent macOS. Après l'autorisation initiale imposée par le navigateur, l'application réutilise automatiquement le périphérique autorisé lorsqu'il expose l'interface VIA Raw HID.",
              )}
            </ExplanatoryText>
            <ControlRow>
              <Label>{t('Show HID Console tab')}</Label>
              <Detail>
                <AccentSlider
                  onChange={() => dispatch(toggleConsoleTab())}
                  isChecked={showConsoleTab}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Fast Key Mapping')}</Label>
              <Detail>
                <AccentSlider
                  onChange={() => dispatch(toggleFastRemap())}
                  isChecked={!disableFastRemap}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Slider Mode')}</Label>
              <Detail>
                <AccentSelect
                  defaultValue={showSliderModeDefaultValue}
                  options={ShowSliderModeOptions}
                  onChange={(option: any) => {
                    option &&
                      dispatch(updateShowSliderValuesMode(option.value));
                  }}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Light Mode')}</Label>
              <Detail>
                <AccentSlider
                  onChange={() => dispatch(toggleThemeMode())}
                  isChecked={themeMode === 'light'}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Keycap Theme')}</Label>
              <Detail>
                <AccentSelect
                  defaultValue={themeDefaultValue}
                  options={themeSelectOptions}
                  onChange={(option: any) => {
                    option && dispatch(updateThemeName(option.value));
                  }}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Render Mode')}</Label>
              <Detail>
                <AccentSelect
                  defaultValue={renderModeDefaultValue}
                  options={renderModeOptions}
                  onChange={(option: any) => {
                    option && dispatch(updateRenderMode(option.value));
                  }}
                />
              </Detail>
            </ControlRow>
            <ControlRow>
              <Label>{t('Show Diagnostic Information')}</Label>

              <Detail>
                {selectedDevice ? (
                  <AccentSlider
                    onChange={() => setShowDiagnostics(!showDiagnostics)}
                    isChecked={showDiagnostics}
                  />
                ) : (
                  <SettingsErrorMessage>
                    {t('Requires connected device')}
                  </SettingsErrorMessage>
                )}
              </Detail>
            </ControlRow>
          </Container>
          <MessageDialog
            isOpen={showDesignTabNotice}
            onConfirm={() => setShowDesignTabNotice(false)}
            confirmLabel="OK"
          >
            {t(
              'You didn\'t click "Confirm". To enable the Design tab, you must confirm first.',
            )}
          </MessageDialog>
          {showDiagnostics && selectedDevice ? (
            <DiagnosticContainer>
              <ControlRow>
                <Label>{t('VIA Firmware Protocol')}</Label>
                <Detail>{selectedDevice.protocol}</Detail>
              </ControlRow>
            </DiagnosticContainer>
          ) : null}
        </SpanOverflowCell>
      </Grid>
    </Pane>
  );
};
