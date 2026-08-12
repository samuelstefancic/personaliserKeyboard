import {useState} from 'react';
import styled from 'styled-components';
import {OverflowCell, SubmenuCell, SubmenuRow} from '../grid';
import {CenterPane} from '../pane';
import {title, component} from '../../icons/lightbulb';
import {GeneralPane} from './submenus/lighting/general';
import {
  LayoutConfigValues,
  Pane as LayoutPane,
} from './submenus/lighting/layout';
import {
  AdvancedLightingValues,
  AdvancedPane,
} from './submenus/lighting/advanced';
import {LightingLabPane} from './submenus/lighting/lighting-lab';
import {getLightingDefinition, isVIADefinitionV2} from '@the-via/reader';
import {useAppSelector} from 'src/store/hooks';
import {getSelectedDefinition} from 'src/store/definitionsSlice';
import type {FC} from 'react';
import {useTranslation} from 'react-i18next';

export const Category = {
  General: {label: 'General', Menu: GeneralPane},
  Layout: {label: 'Layout', Menu: LayoutPane},
  Advanced: {label: 'Advanced', Menu: AdvancedPane},
  Lab: {label: 'Lab', Menu: LightingLabPane},
};

const LightingPane = styled(CenterPane)`
  height: 100%;
  background: var(--color_dark_grey);
`;

const Container = styled.div`
  display: flex;
  align-items: center;
  flex-direction: column;
  padding: 0 12px;
`;

const MenuContainer = styled.div`
  padding: 15px 20px 20px 10px;
`;

export const Pane: FC = () => {
  const {t} = useTranslation();
  const selectedDefinition = useAppSelector(getSelectedDefinition);

  const [selectedCategory, setSelectedCategory] = useState(Category.General);

  const getMenus = () => {
    if (!isVIADefinitionV2(selectedDefinition)) {
      return [Category.Lab];
    }

    const lightingDefinition = getLightingDefinition(
      selectedDefinition.lighting,
    );
    const hasGeneral = lightingDefinition.supportedLightingValues.length !== 0;
    const hasLayouts = LayoutConfigValues.some(
      (value) =>
        lightingDefinition.supportedLightingValues.indexOf(value) !== -1,
    );
    const hasAdvanced = AdvancedLightingValues.some(
      (value) =>
        lightingDefinition.supportedLightingValues.indexOf(value) !== -1,
    );

    return [
      ...(hasGeneral ? [Category.General] : []),
      ...(hasLayouts ? [Category.Layout] : []),
      ...(hasAdvanced ? [Category.Advanced] : []),
      Category.Lab,
    ].filter(({Menu}) => !!Menu);
  };

  const menus = getMenus();
  const activeCategory = menus.includes(selectedCategory)
    ? selectedCategory
    : menus[0];
  const ActiveMenu = activeCategory.Menu;

  return (
    <>
      <SubmenuCell>
        <MenuContainer>
          {menus.map((menu) => (
            <SubmenuRow
              $selected={activeCategory === menu}
              onClick={() => setSelectedCategory(menu)}
              key={menu.label}
            >
              {t(menu.label)}
            </SubmenuRow>
          ))}
        </MenuContainer>
      </SubmenuCell>
      <OverflowCell>
        <LightingPane>
          <Container>
            <ActiveMenu />
          </Container>
        </LightingPane>
      </OverflowCell>
    </>
  );
};

export const Icon = component;
export const Title = title;
