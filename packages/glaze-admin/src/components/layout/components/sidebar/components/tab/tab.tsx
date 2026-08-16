import PanelOpenIcon from '@assets/svg/panel-open.svg?react';
import { animated, useSpring } from '@react-spring/web';

import { Tooltip } from '@/components/tooltip';
import { useTranslation } from '@/i18n';

import './tab.css';

interface TabProps {
	isOpen: boolean;
	onOpen: () => void;
}

/**
 * The handle that slides out from the rail to reopen the panel.
 *
 * It translates off-screen while the panel is open, delayed so it disappears behind the panel rather
 * than racing it.
 *
 * @param props.isOpen - Whether the panel is currently open.
 * @param props.onOpen - Called when the handle is activated.
 * @returns The handle.
 */
export function SidebarTab({ isOpen, onOpen }: TabProps) {
	const { t } = useTranslation();

	const spring = useSpring({
		transform: isOpen ? 'translateX(-200%)' : 'translateX(0%)',
		delay: isOpen ? 0 : 232,
		config: isOpen ? { tension: 300, friction: 24 } : { tension: 200, friction: 24 },
	});

	return (
		<Tooltip label={t.nav.toggleSidebar} shortcut="⌘B" disabled={isOpen}>
			<animated.button
				type="button"
				className="sidebar-tab flex-col flex-center"
				style={spring}
				aria-label={t.nav.openPanel}
				aria-expanded={isOpen}
				onClick={isOpen ? undefined : onOpen}
			>
				<PanelOpenIcon aria-hidden="true" />
			</animated.button>
		</Tooltip>
	);
}
