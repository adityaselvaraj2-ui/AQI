import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import React, { useState, useEffect, useRef } from 'react';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONSTANTS = {
  itemSize: 48,
  containerSize: 250,
  openStagger: 0.02,
  closeStagger: 0.07
};

const STYLES: Record<string, Record<string, string>> = {
  trigger: {
    container:
      'rounded-full flex items-center bg-foreground justify-center cursor-pointer outline-none ring-0 hover:brightness-125 transition-all duration-100 z-50',
    active: 'bg-foreground'
  },
  item: {
    container:
      'rounded-full flex items-center justify-center absolute bg-muted hover:bg-muted/50 cursor-pointer',
    label: 'text-xs text-foreground absolute top-full left-1/2 -translate-x-1/2 mt-1 whitespace-nowrap'
  }
};

const pointOnCircle = (
  i: number,
  n: number,
  r: number,
  cx = 0,
  cy = 0,
  direction: 'all' | 'down' | 'up' = 'all',
  tier?: 1 | 2,
  tierIndex?: number,
  tierTotal?: number
) => {
  if (direction === 'down') {
    if (tier) {
      if (tier === 1) {
        // Outer Arc: Authority sections
        // Span trimmed on the right side (28° instead of 15°) so the widest icon
        // keeps clear of the header's alert bell instead of touching it.
        const outerR = Math.max(r * 1.35, 115);
        const total = tierTotal && tierTotal > 1 ? tierTotal : 1;
        const idx = tierIndex ?? i;
        if (total === 1) {
          const theta = Math.PI / 2;
          return { x: cx + outerR * Math.cos(theta), y: cy + outerR * Math.sin(theta) };
        }
        const startAngle = (158 * Math.PI) / 180;
        const endAngle = (28 * Math.PI) / 180;
        const step = (endAngle - startAngle) / (total - 1);
        const theta = startAngle + idx * step;
        const x = cx + outerR * Math.cos(theta);
        const y = cy + outerR * Math.sin(theta);
        return { x, y };
      } else {
        // Inner Arc: Citizen sections & Overview
        // Right side pulled in (48° instead of 30°) for bell clearance.
        const innerR = Math.max(r * 0.78, 68);
        const total = tierTotal && tierTotal > 1 ? tierTotal : 1;
        const idx = tierIndex ?? i;
        if (total === 1) {
          const theta = Math.PI / 2;
          return { x: cx + innerR * Math.cos(theta), y: cy + innerR * Math.sin(theta) };
        }
        const startAngle = (145 * Math.PI) / 180;
        const endAngle = (48 * Math.PI) / 180;
        const step = (endAngle - startAngle) / (total - 1);
        const theta = startAngle + idx * step;
        const x = cx + innerR * Math.cos(theta);
        const y = cy + innerR * Math.sin(theta);
        return { x, y };
      }
    }

    if (n === 1) {
      const theta = Math.PI / 2;
      return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
    }
    const angleSpan = n > 4 ? 150 : 120;
    const startDeg = 90 + angleSpan / 2;
    const endDeg = 90 - angleSpan / 2;
    const startAngle = (startDeg * Math.PI) / 180;
    const endAngle = (endDeg * Math.PI) / 180;
    const step = (endAngle - startAngle) / (n - 1);
    const theta = startAngle + i * step;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    return { x, y };
  }
  if (direction === 'up') {
    if (n === 1) {
      const theta = -Math.PI / 2;
      return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
    }
    const startAngle = (210 * Math.PI) / 180;
    const endAngle = (330 * Math.PI) / 180;
    const step = (endAngle - startAngle) / (n - 1);
    const theta = startAngle + i * step;
    const x = cx + r * Math.cos(theta);
    const y = cy + r * Math.sin(theta);
    return { x, y };
  }
  const theta = (2 * Math.PI * i) / n - Math.PI / 2;
  const x = cx + r * Math.cos(theta);
  const y = cy + r * Math.sin(theta) + 0;
  return { x, y };
};

export interface CircleMenuItem {
  label: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
  tier?: 1 | 2;
  badge?: string;
  badgeColor?: string;
}

interface MenuItemProps {
  icon: React.ReactNode;
  label: string;
  href?: string;
  onClick?: () => void;
  index: number;
  totalItems: number;
  isOpen: boolean;
  itemSize?: number;
  radius?: number;
  direction?: 'all' | 'down' | 'up';
  onItemClick?: () => void;
  tier?: 1 | 2;
  tierIndex?: number;
  tierTotal?: number;
  badge?: string;
  badgeColor?: string;
}

const MenuItem = ({
  icon,
  label,
  href = '#',
  onClick,
  index,
  totalItems,
  isOpen,
  itemSize = CONSTANTS.itemSize,
  radius = CONSTANTS.containerSize / 2,
  direction = 'all',
  onItemClick,
  tier,
  tierIndex,
  tierTotal,
  badge,
  badgeColor,
}: MenuItemProps) => {
  const { x, y } = pointOnCircle(index, totalItems, radius, 0, 0, direction, tier, tierIndex, tierTotal);
  const [hovering, setHovering] = useState(false);

  const handleClick = (e: React.MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      onClick();
    }
    if (onItemClick) {
      onItemClick();
    }
  };

  return (
    <a
      href={href}
      className={STYLES.item.container}
      onClick={handleClick}
      tabIndex={isOpen ? 0 : -1}
      aria-label={label}
      style={{
        pointerEvents: isOpen ? 'auto' : 'none',
      }}
    >
      <motion.button
        type="button"
        animate={{
          x: isOpen ? x : 0,
          y: isOpen ? y : 0
        }}
        whileHover={{
          scale: 1.15,
          transition: {
            duration: 0.1,
            delay: 0
          }
        }}
        whileTap={{ scale: 0.95 }}
        transition={{
          delay: isOpen ? index * CONSTANTS.openStagger : index * CONSTANTS.closeStagger,
          type: 'spring',
          stiffness: 300,
          damping: 26
        }}
        style={{
          height: itemSize - 2,
          width: itemSize - 2,
          /* Raise the hovered item above its siblings so its label tooltip
             is never painted underneath the neighbouring icons. */
          zIndex: hovering ? 60 : 10
        }}
        className={cn(
          STYLES.item.container,
          'backdrop-blur-xl border border-[var(--hairline-2)] shadow-[0_4px_20px_rgba(0,0,0,0.25)] text-[var(--bone)] bg-[var(--slab)] hover:bg-[var(--slab-hi)] hover:border-[var(--hairline-2)]'
        )}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        tabIndex={-1}
      >
        {icon}
        {hovering && (
          <div
            className={cn(
              STYLES.item.label,
              'px-2.5 py-1 rounded-md bg-[var(--deep)] border border-[var(--hairline-2)] text-[var(--bone)] font-mono text-[11px] shadow-2xl z-50 tracking-wider pointer-events-none flex items-center gap-1.5 whitespace-nowrap'
            )}
          >
            {badge && (
              <span
                className={cn(
                  'text-[9px] font-bold px-1.5 py-0.5 rounded tracking-widest uppercase',
                  badgeColor || 'bg-cyan-500/20 text-cyan-500 border border-cyan-500/30'
                )}
              >
                {badge}
              </span>
            )}
            <span>{label}</span>
          </div>
        )}
      </motion.button>
    </a>
  );
};

interface MenuTriggerProps {
  setIsOpen: (isOpen: boolean) => void;
  isOpen: boolean;
  itemsLength: number;
  closeAnimationCallback: () => void;
  openIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  itemSize?: number;
  className?: string;
  active?: boolean;
  activeClassName?: string;
  title?: string;
  triggerLabel?: string;
}

const MenuTrigger = ({
  setIsOpen,
  isOpen,
  itemsLength,
  closeAnimationCallback,
  openIcon,
  closeIcon,
  itemSize = CONSTANTS.itemSize,
  className,
  active,
  activeClassName,
  title,
  triggerLabel,
}: MenuTriggerProps) => {
  const animate = useAnimationControls();
  const shakeAnimation = useAnimationControls();

  const scaleTransition = Array.from({ length: Math.max(1, itemsLength - 1) })
    .map((_, index) => index + 1)
    .reduce((acc, _, index) => {
      const increasedValue = index * 0.15;
      acc.push(1 + increasedValue);
      return acc;
    }, [] as number[]);

  const closeAnimation = async () => {
    shakeAnimation.start({
      translateX: [0, 2, -2, 0, 2, -2, 0],
      transition: {
        duration: CONSTANTS.closeStagger,
        ease: 'linear',
        repeat: Infinity,
        repeatType: 'loop'
      }
    });
    for (let i = 0; i < scaleTransition.length; i++) {
      await animate.start(
        triggerLabel
          ? {
              scale: Math.min(1 + i * 0.04, 1.15),
              transition: {
                duration: CONSTANTS.closeStagger / 2,
                ease: 'linear'
              }
            }
          : {
              height: Math.min(
                itemSize * scaleTransition[i],
                itemSize + itemSize / 2
              ),
              width: Math.min(
                itemSize * scaleTransition[i],
                itemSize + itemSize / 2
              ),
              transition: {
                duration: CONSTANTS.closeStagger / 2,
                ease: 'linear'
              }
            }
      );
      if (i !== scaleTransition.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, CONSTANTS.closeStagger * 1000));
      }
    }

    shakeAnimation.stop();
    shakeAnimation.start({
      translateX: 0,
      transition: {
        duration: 0
      }
    });

    animate.start(
      triggerLabel
        ? {
            scale: 1,
            transition: {
              duration: 0.1,
              ease: 'backInOut'
            }
          }
        : {
            height: itemSize,
            width: itemSize,
            transition: {
              duration: 0.1,
              ease: 'backInOut'
            }
          }
    );
  };

  return (
    <motion.div animate={shakeAnimation} className="relative z-50 pointer-events-auto">
      <motion.button
        type="button"
        animate={animate}
        title={title}
        style={{
          height: itemSize,
          minWidth: triggerLabel ? 'auto' : itemSize,
          paddingLeft: triggerLabel ? '0.75rem' : 0,
          paddingRight: triggerLabel ? '0.85rem' : 0,
        }}
        className={cn(
          STYLES.trigger.container,
          isOpen && STYLES.trigger.active,
          active && (activeClassName || 'ring-2 ring-emerald-400/50 shadow-[0_0_12px_rgba(52,211,153,0.4)]'),
          className
        )}
        onClick={() => {
          if (isOpen) {
            setIsOpen(false);
            closeAnimationCallback();
            closeAnimation();
          } else {
            setIsOpen(true);
          }
        }}
      >
        <div className="flex items-center justify-center gap-1.5">
          <AnimatePresence mode="popLayout">
            {isOpen ? (
              <motion.span
                key="menu-close"
                initial={{
                  opacity: 0,
                  filter: 'blur(10px)'
                }}
                animate={{
                  opacity: 1,
                  filter: 'blur(0px)'
                }}
                exit={{
                  opacity: 0,
                  filter: 'blur(10px)'
                }}
                transition={{
                  duration: 0.2
                }}
                className="flex items-center justify-center"
              >
                {closeIcon}
              </motion.span>
            ) : (
              <motion.span
                key="menu-open"
                initial={{
                  opacity: 0,
                  filter: 'blur(10px)'
                }}
                animate={{
                  opacity: 1,
                  filter: 'blur(0px)'
                }}
                exit={{
                  opacity: 0,
                  filter: 'blur(10px)'
                }}
                transition={{
                  duration: 0.2
                }}
                className="flex items-center justify-center"
              >
                {openIcon}
              </motion.span>
            )}
          </AnimatePresence>
          {triggerLabel && (
            <span className="font-mono text-xs font-semibold tracking-wider select-none text-current whitespace-nowrap">
              {triggerLabel}
            </span>
          )}
        </div>
      </motion.button>
    </motion.div>
  );
};

export interface CircleMenuProps {
  items: CircleMenuItem[];
  openIcon?: React.ReactNode;
  closeIcon?: React.ReactNode;
  containerSize?: number;
  itemSize?: number;
  radius?: number;
  direction?: 'all' | 'down' | 'up';
  fitTrigger?: boolean;
  className?: string;
  triggerClassName?: string;
  active?: boolean;
  activeClassName?: string;
  title?: string;
  triggerLabel?: string;
}

const CircleMenu = ({
  items,
  openIcon = <Menu size={18} className="text-background" />,
  closeIcon = <X size={18} className="text-background" />,
  containerSize = CONSTANTS.containerSize,
  itemSize = CONSTANTS.itemSize,
  radius,
  direction = 'all',
  fitTrigger = false,
  className,
  triggerClassName,
  active = false,
  activeClassName,
  title,
  triggerLabel,
}: CircleMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const animate = useAnimationControls();
  const menuRef = useRef<HTMLDivElement>(null);

  const effectiveRadius = radius ?? (containerSize / 2);

  const closeAnimationCallback = async () => {
    await animate.start({
      rotate: -360,
      filter: 'blur(1px)',
      transition: {
        duration: CONSTANTS.closeStagger * (items.length + 2),
        ease: 'linear'
      }
    });
    await animate.start({
      rotate: 0,
      filter: 'blur(0px)',
      transition: {
        duration: 0
      }
    });
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        closeAnimationCallback();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div
      ref={menuRef}
      style={{
        width: fitTrigger ? (triggerLabel ? 'auto' : itemSize) : containerSize,
        height: fitTrigger ? itemSize : containerSize
      }}
      className={cn(
        'relative flex items-center justify-center place-self-center',
        !isOpen && 'pointer-events-none',
        className
      )}
    >
      <MenuTrigger
        setIsOpen={setIsOpen}
        isOpen={isOpen}
        itemsLength={items.length}
        closeAnimationCallback={closeAnimationCallback}
        openIcon={openIcon}
        closeIcon={closeIcon}
        itemSize={itemSize}
        className={triggerClassName}
        active={active}
        activeClassName={activeClassName}
        title={title}
        triggerLabel={triggerLabel}
      />
      <motion.div
        animate={animate}
        className={cn('absolute inset-0 z-30 flex items-center justify-center pointer-events-none')}
      >
        {items.map((item, index) => {
          const tier1Items = items.filter((it) => it.tier === 1);
          const tier2Items = items.filter((it) => it.tier === 2);
          const tierIndex = item.tier === 1
            ? tier1Items.indexOf(item)
            : item.tier === 2
            ? tier2Items.indexOf(item)
            : undefined;
          const tierTotal = item.tier === 1
            ? tier1Items.length
            : item.tier === 2
            ? tier2Items.length
            : undefined;

          return (
            <MenuItem
              key={`menu-item-${index}`}
              icon={item.icon}
              label={item.label}
              href={item.href}
              onClick={item.onClick}
              index={index}
              totalItems={items.length}
              isOpen={isOpen}
              itemSize={itemSize}
              radius={effectiveRadius}
              direction={direction}
              tier={item.tier}
              tierIndex={tierIndex}
              tierTotal={tierTotal}
              badge={item.badge}
              badgeColor={item.badgeColor}
              onItemClick={() => {
                setIsOpen(false);
                closeAnimationCallback();
              }}
            />
          );
        })}
      </motion.div>
    </div>
  );
};

export { CircleMenu };
