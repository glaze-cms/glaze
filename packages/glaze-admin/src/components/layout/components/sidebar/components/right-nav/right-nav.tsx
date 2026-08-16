import MagnifyingGlass from '@assets/svg/magnifying-glass.svg?react';
import MultipleIcon from '@assets/svg/multiple.svg?react';
import PanelClose from '@assets/svg/panel-close.svg?react';
import PlusIcon from '@assets/svg/plus.svg?react';
import { animated, useSpring } from '@react-spring/web';

import { Button } from '@/components/button';
import { Collapsible } from '@/components/collapsible';
import { Input } from '@/components/input';
import { Tooltip } from '@/components/tooltip';
import { useTranslation } from '@/i18n';

import './right-nav.css';

interface RightNavProps {
	isOpen: boolean;
	onClose: () => void;
}

/**
 * The slide-out panel beside the rail: search, schema creation, and the collection index.
 *
 * The collection list is empty because the server exposes no schema/metadata endpoint yet — the panel
 * renders its real empty state rather than placeholder entries.
 *
 * @param props.isOpen - Whether the panel is showing.
 * @param props.onClose - Called when the panel is dismissed.
 * @returns The panel.
 */
export function RightNav({ isOpen, onClose }: RightNavProps) {
	const { t } = useTranslation();

	const spring = useSpring({
		transform: isOpen ? 'translateX(0%)' : 'translateX(-120%)',
		config: isOpen ? { tension: 288, friction: 32 } : { tension: 264, friction: 48, clamp: true },
	});

	return (
		<animated.nav className="right-nav" style={spring} aria-hidden={!isOpen} inert={!isOpen}>
			<div className="top">
				<Tooltip label={t.nav.closePanel} shortcut="⌘B" side="bottom">
					<button
						type="button"
						className="close-button"
						aria-label={t.nav.closePanel}
						onClick={onClose}
					>
						<PanelClose aria-hidden="true" />
					</button>
				</Tooltip>
				<Input
					className="right-nav-input"
					LeftIcon={<MagnifyingGlass />}
					placeholder={t.nav.search}
					aria-label={t.nav.search}
				/>
			</div>

			<div className="separator" aria-hidden="true" />

			<div className="bottom">
				<Tooltip label={t.nav.newSchemaUnavailable} side="bottom">
					<Button variant="primary" LeftIcon={<PlusIcon />} size="small" disabled>
						{t.nav.newSchema}
					</Button>
				</Tooltip>

				<Collapsible
					trigger={{ Icon: <MultipleIcon />, title: t.nav.collections }}
					panel={{ elements: [], emptyLabel: t.nav.noCollections }}
				/>
			</div>
		</animated.nav>
	);
}
