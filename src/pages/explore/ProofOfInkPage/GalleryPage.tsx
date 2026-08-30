import { useEffect, useState } from 'react'
import { Container, Row, Col, Modal, Spinner } from 'react-bootstrap'
import styled from 'styled-components'
import { backendImageUrl, fetchGallery, type GalleryEntry } from '@/chain/bulletin'
import { AccountIdentity } from '@/components/AccountIdentity'
import { ChainError } from '@/pages/explore/components/ChainError'
import { Identicon } from '@/pages/explore/components/Identicon'

/**
 * The public Proof-of-Ink gallery.
 *
 * Reads from the backend, which returns one wallpaper per member whose owner is still a
 * Society member/candidate on chain (docs/adr/0002-0003). Each entry names its owner and
 * the CID of the cached wallpaper the backend serves.
 */
const GalleryPage = (): JSX.Element => {
  const [entries, setEntries] = useState<GalleryEntry[] | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const load = () => {
    setError(null)
    setEntries(null)
    fetchGallery()
      .then(setEntries)
      .catch((caught) => setError(caught instanceof Error ? caught : new Error(String(caught))))
  }

  useEffect(load, [])

  if (error) return <ChainError error={error} onRetry={load} />
  if (!entries) return <Spinner className="mx-auto d-block" animation="border" role="status" variant="primary" />

  return (
    <Container>
      <Row>
        {entries.map((entry) => (
          <ProofOfInkImage key={entry.cid} address={entry.address} src={backendImageUrl(entry.cid)} />
        ))}
      </Row>
    </Container>
  )
}

const ProofOfInkImage = ({ address, src }: { address: string; src: string }): JSX.Element => {
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(true)
  const [modalShow, setModalShow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading && !error) {
        setError(true)
        setLoading(false)
      }
    }, 10_000)
    return () => clearTimeout(timer)
  }, [loading, error])

  return (
    <>
      <Col xs={12} sm={6} md={6} lg={3} className="mb-3">
        <Border>
          <ImageContainer onClick={() => !loading && !error && setModalShow(true)} $clickable={!error && !loading}>
            <Row>
              <Col xs={12} className="p-0">
                {loading && !error && (
                  <Spinner className="m-0 mt-3" animation="border" role="status" variant="secondary" />
                )}
                {!loading && error && <p className="m-0 mt-3">Missing Proof-of-Ink</p>}
                <StyledImage
                  src={src}
                  onLoad={() => {
                    setError(false)
                    setLoading(false)
                  }}
                  onError={() => {
                    setError(true)
                    setLoading(false)
                  }}
                  style={loading || error ? { display: 'none' } : {}}
                />
              </Col>
            </Row>
          </ImageContainer>
          <MemberInformation>
            <Row className="d-flex align-items-center">
              <Col xs={2} className="text-center">
                <Identicon value={address} size={32} theme="polkadot" />
              </Col>
              <Col xs={9} md={9} lg={10} className="text-center text-truncate">
                <AccountIdentity accountId={address} />
              </Col>
            </Row>
          </MemberInformation>
        </Border>
      </Col>
      <StyledModalContent size="lg" show={modalShow} onHide={() => setModalShow(false)} centered>
        <Modal.Body style={{ display: 'flex', justifyContent: 'center' }}>
          <StyledModalImage src={src} />
        </Modal.Body>
      </StyledModalContent>
    </>
  )
}

const StyledModalContent = styled(Modal)`
  .modal-content {
    background-color: ${(props) => props.theme.colors.lightGrey};
  }
`
const Border = styled.div`
  border: 3px solid ${(props) => props.theme.colors.lightGrey};
  border-radius: 10px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.2);
`
const MemberInformation = styled.div`
  padding: 13px 10px 10px;
  background-color: ${(props) => props.theme.colors.lightGrey};
`
const ImageContainer = styled.div<{ $clickable: boolean }>`
  display: flex;
  justify-content: center;
  align-items: center;
  height: 280px;
  width: 100%;
  overflow: hidden;
  cursor: ${(props) => (props.$clickable ? 'pointer' : 'default')};
  position: relative;
`
const StyledImage = styled.img`
  max-width: 100%;
  max-height: 100%;
`
const StyledModalImage = styled.img`
  max-width: 100%;
  max-height: 80vh;
`
export { GalleryPage }
