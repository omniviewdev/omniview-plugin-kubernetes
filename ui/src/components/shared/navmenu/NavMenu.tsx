import { Chip, IconButton, Stack, Text } from '@omniviewdev/base-ui';
import { usePluginRouter } from '@omniviewdev/runtime';
import React from 'react';
import { LuChevronDown } from 'react-icons/lu';
import { useParams } from 'react-router';

import { IsImage } from '../../../utils/url';
import Icon from '../Icon';

import styles from './NavMenu.module.css';
import { SidebarItem, SidebarSection, type SidebarListItemProps, type SidebarProps } from './types';

const decoratorChipStyle: React.CSSProperties = { borderRadius: 4, fontSize: 10 };

const getInitialOpenState = (
  items: SidebarItem[] | undefined,
  sections: SidebarSection[] | undefined,
) => {
  const state: Record<string, boolean> = {};

  items?.forEach((item) => {
    if (item.defaultExpanded) {
      state[item.id] = true;
    }
  });

  sections?.forEach((section) => {
    section.items?.forEach((item) => {
      if (item.defaultExpanded) {
        state[item.id] = true;
      }
    });
  });

  return state;
};

/**
 * Render a navigation menu in a sidebar layout
 */
const NavMenu: React.FC<SidebarProps> = ({ header, size, items, sections }) => {
  const { id } = useParams<{ id: string }>();
  const { location, navigate } = usePluginRouter();

  const selected = location.pathname.split('/').pop();

  const onSelect = React.useCallback(
    (resourceID: string) => {
      navigate(`/cluster/${id}/resources/${resourceID}`);
    },
    [navigate, id],
  );

  if (items == null && sections == null) {
    throw new Error('You must pass either items or sections');
  }

  if (Boolean(items?.length) && Boolean(sections?.length)) {
    throw new Error('You can only pass items or sections, not both');
  }

  const [menuState, setMenuState] = React.useState(() => ({
    connectionID: id,
    items,
    sections,
    open: getInitialOpenState(items, sections),
  }));
  if (menuState.connectionID !== id || menuState.items !== items || menuState.sections !== sections) {
    setMenuState({ connectionID: id, items, sections, open: getInitialOpenState(items, sections) });
  }
  const { open } = menuState;

  /**
   * Handle the selection of a sidebar item
   */
  const handleSelect = React.useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect],
  );

  /**
   * Toggle the open state of a sidebar section
   */
  const toggleOpenState = React.useCallback(
    (id: string) => {
      setMenuState((prev) => ({
        ...prev,
        open: { ...prev.open, [id]: !prev.open[id] },
      }));
    },
    [],
  );

  return (
    <Stack direction="column" spacing={0} className={styles.Root} data-size={size ?? 'md'}>
      {header}
      <ul className={styles.List}>
        {/** Sections */}
        {sections?.map((section) => (
          <li key={section.id}>
            {section.title && <div className={styles.Subheader}>{section.title}</div>}
            <ul aria-label={section.title} className={styles.NestedList}>
              {section.items.map((item) => (
                <SidebarListItem
                  key={item.id}
                  item={item}
                  openState={open}
                  onToggleOpen={toggleOpenState}
                  selected={selected}
                  onSelect={handleSelect}
                />
              ))}
            </ul>
          </li>
        ))}

        {/** Direct mapped items */}
        {items?.map((item) => (
          <SidebarListItem
            key={item.id}
            item={item}
            openState={open}
            onToggleOpen={toggleOpenState}
            selected={selected}
            onSelect={handleSelect}
          />
        ))}
      </ul>
    </Stack>
  );
};

NavMenu.displayName = 'NavMenu';
// NavMenu.whyDidYouRender = true;

/**
 * Recursively render the sidebar items
 *
 * TODO - measure perf and check for necessary memoization opportunities
 */
const SidebarListItem: React.FC<SidebarListItemProps> = ({
  level = 0,
  item,
  openState,
  onToggleOpen,
  selected,
  onSelect,
}) => {
  const { id } = item;
  const height = level === 0 ? 28 : 24;

  const handleClick = React.useCallback(
    (e: React.SyntheticEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (item.children?.length) {
        // Shouldn't be selectable if it has children
        onToggleOpen(id);
      } else {
        onSelect(id);
      }
    },
    [onToggleOpen, onSelect, item.children, id],
  );

  const MemoizedIcon = React.useMemo(
    () => (
      <LuChevronDown
        className={openState[id] ? styles.Chevron : `${styles.Chevron} ${styles.ChevronClosed}`}
      />
    ),
    [openState, id],
  );

  const isParent = Boolean(item.children?.length);

  return (
    <li
      key={id}
      className={item.icon ? styles.Item : `${styles.Item} ${styles.ItemNoIcon}`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleClick(e);
        }}
        className={styles.Row}
        data-selected={selected === id ? 'true' : 'false'}
        style={{ maxHeight: height, minHeight: height }}
      >
        {item.icon && (
          <div className={styles.IconContainer}>
            {typeof item.icon === 'string' ? (
              IsImage(item.icon) ? (
                <img src={item.icon} alt="" className={styles.IconImage} />
              ) : (
                <Icon name={item.icon} size={16} />
              )
            ) : (
              item.icon
            )}
          </div>
        )}
        <div className={styles.Label}>
          <Text
            weight={level === 0 || isParent ? 'semibold' : undefined}
            size={level === 0 || isParent ? 'sm' : 'xs'}
            style={{ fontWeight: selected === id ? 600 : 500 }}
          >
            {item.label}
          </Text>
        </div>
        {isParent ? (
          <IconButton
            variant="ghost"
            size="sm"
            color="neutral"
            aria-label={openState[id] ? `Collapse ${item.label}` : `Expand ${item.label}`}
            onClick={handleClick}
          >
            {MemoizedIcon}
          </IconButton>
        ) : typeof item.decorator === 'string' ? (
          <Chip size="sm" variant="outline" color="neutral" style={decoratorChipStyle}>
            {item.decorator}
          </Chip>
        ) : (
          item.decorator
        )}
      </div>
      {isParent && Boolean(openState[id]) && (
        <ul aria-label={item.label} className={styles.NestedList}>
          {item.children?.map((child) => (
            <SidebarListItem
              level={level + 1}
              key={child.id}
              item={child}
              parentID={id}
              openState={openState}
              onToggleOpen={onToggleOpen}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
};

SidebarListItem.displayName = 'SidebarListItem';
// SidebarListItem.whyDidYouRender = true;

export default NavMenu;
