import { useDashboard } from '../store';
import { MemoryRiver } from './MemoryRiver';
import { DocumentPreview } from './DocumentPreview';
import { FileEditor } from './FileEditor';
import { ProjectDrillDown } from './ProjectDrillDown';
import { BrainNodeDrillDown } from './BrainNodeDrillDown';

export function RightPanel() {
  const { selectedProject, selectedBrainNode, rightPanelTab, setRightPanelTab, documents, uploadedDocuments } = useDashboard();

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
      {/* Tab bar */}
      <div className="right-panel-tabs">
        <button
          className={`right-panel-tab ${rightPanelTab === 'memory' ? 'right-panel-tab--active' : ''}`}
          onClick={() => setRightPanelTab('memory')}
        >
          Memory
        </button>
        <button
          className={`right-panel-tab ${rightPanelTab === 'documents' ? 'right-panel-tab--active' : ''}`}
          onClick={() => setRightPanelTab('documents')}
        >
          Generated Docs
          {documents.length > 0 && (
            <span className="right-panel-tab__badge">{documents.length}</span>
          )}
        </button>
        <button
          className={`right-panel-tab ${rightPanelTab === 'uploaded' ? 'right-panel-tab--active' : ''}`}
          onClick={() => setRightPanelTab('uploaded')}
        >
          Uploaded Docs
          {uploadedDocuments.length > 0 && (
            <span className="right-panel-tab__badge">{uploadedDocuments.length}</span>
          )}
        </button>
        <button
          className={`right-panel-tab ${rightPanelTab === 'editor' ? 'right-panel-tab--active' : ''}`}
          onClick={() => setRightPanelTab('editor')}
        >
          Editor
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {rightPanelTab === 'memory' ? <MemoryRiver /> :
         rightPanelTab === 'documents' ? <DocumentPreview docs={documents} emptyMessage="documents will appear here as the active engine creates files" /> :
         rightPanelTab === 'uploaded' ? <DocumentPreview docs={uploadedDocuments} emptyMessage="attach a file in chat and it will show up here" /> :
         <FileEditor />}
      </div>

      {/* Drill-downs overlay everything */}
      {selectedProject && <ProjectDrillDown />}
      {selectedBrainNode && !selectedProject && <BrainNodeDrillDown />}
    </div>
  );
}
