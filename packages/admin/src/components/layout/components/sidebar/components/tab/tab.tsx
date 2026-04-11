import { animated, useSpring } from '@react-spring/web';

/* Assets */
import PanelOpenIcon from '@assets/svg/panel-open.svg?react';

/* Components */
import { Tooltip } from '@/components/tooltip';

/* Styles */
import './tab.css';

interface TabProps {
	isOpen: boolean;
	onOpen: () => void;
}

export function DashboardLayoutSidebarTab({ isOpen, onOpen }: TabProps) {
	const spring = useSpring({
		transform: isOpen ? 'translateX(-200%)' : 'translateX(0%)',
		delay: isOpen ? 0 : 232,
		config: isOpen
			? { tension: 300, friction: 24 }
			: { tension: 200, friction: 24 },
	});

	return (
		<Tooltip label="Toggle" shortcut="⌘B" disabled={isOpen}>
			<animated.button
				type="button"
				className="dashboard-layout-sidebar-tab flex-col flex-center"
				style={spring}
				aria-label="Open sidebar"
				onClick={isOpen ? undefined : onOpen}
			>
				<PanelOpenIcon aria-hidden="true" />
			</animated.button>
		</Tooltip>
	);
}
