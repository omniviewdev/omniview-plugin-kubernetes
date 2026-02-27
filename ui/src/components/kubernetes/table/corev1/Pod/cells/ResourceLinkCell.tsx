import React from 'react';

import ResourceLinkChip from '../../../../../shared/ResourceLinkChip';

type Props = {
  /** ID of the plugin this resource belongs to */
  pluginID?: string;

  /** ID of the connection this is connecting to */
  connectionId: string;

  /** Namespace of the resource being referenced (if there is one) */
  namespace?: string;

  /** ID of the resource being referenced */
  resourceId: string;

  /** The key identifying the resource (e.g. core::v1::Node) */
  resourceKey: string;

  /** The readable name of the resource (e.g. Node) */
  resourceName?: string;
};

/**
 * Display the cell as a link to another resource with kind-appropriate icon and color.
 */
const ResourceLinkCell: React.FC<Props> = ({
  pluginID,
  connectionId,
  namespace,
  resourceId,
  resourceKey,
  resourceName,
}) => (
  <ResourceLinkChip
    pluginID={pluginID}
    connectionID={connectionId}
    namespace={namespace}
    resourceID={resourceId}
    resourceKey={resourceKey}
    resourceName={resourceName}
  />
);

export default ResourceLinkCell;
